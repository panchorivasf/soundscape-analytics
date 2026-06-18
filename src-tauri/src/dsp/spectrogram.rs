use crate::dsp::window;
use rayon::prelude::*;
use realfft::RealFftPlanner;
use rustfft::num_complex::Complex;
use std::cell::RefCell;

/// seewave default overlap percentage.
const DEFAULT_OVERLAP: f64 = 87.5;

thread_local! {
    static FFT_CTX: RefCell<Option<FftScratch>> = RefCell::new(None);
}

struct FftScratch {
    r2c: std::sync::Arc<dyn realfft::RealToComplex<f64>>,
    indata: Vec<f64>,
    outdata: Vec<Complex<f64>>,
    wl: usize,
}

impl FftScratch {
    fn for_wl(wl: usize) -> Self {
        let mut planner = RealFftPlanner::<f64>::new();
        let r2c = planner.plan_fft_forward(wl);
        let outdata = r2c.make_output_vec();
        Self {
            r2c,
            indata: vec![0.0; wl],
            outdata,
            wl,
        }
    }

    fn process_frame(
        &mut self,
        samples: &[f64],
        frame_start: usize,
        win: &[f64],
        correction: f64,
        out_bins: &mut [f64],
    ) {
        for (i, w) in win.iter().enumerate() {
            self.indata[i] = samples.get(frame_start + i).copied().unwrap_or(0.0) * w;
        }
        self.r2c
            .process(&mut self.indata, &mut self.outdata)
            .expect("fft");
        let n_bins = self.wl / 2;
        for k in 0..n_bins {
            out_bins[k] = self.outdata[k].norm() * correction;
        }
    }
}

#[derive(Debug, Clone)]
pub struct Spectrogram {
    /// Row-major: amp[row * n_frames + col]
    pub data: Vec<f64>,
    pub n_bins: usize,
    pub n_frames: usize,
    pub freqs_khz: Vec<f64>,
    pub sample_rate: u32,
    pub wl: usize,
}

impl Spectrogram {
    pub fn row(&self, bin: usize) -> &[f64] {
        let start = bin * self.n_frames;
        &self.data[start..start + self.n_frames]
    }

    pub fn rows(&self) -> impl Iterator<Item = &[f64]> {
        (0..self.n_bins).map(move |i| self.row(i))
    }

    pub fn as_matrix(&self) -> Vec<Vec<f64>> {
        (0..self.n_bins)
            .map(|i| self.row(i).to_vec())
            .collect()
    }
}

pub struct SpectroOptions {
    pub wl: usize,
    pub win_fun: String,
    pub overlap_pct: f64,
    pub normalized: bool,
    pub amplitude_correction: bool,
    pub noise_red: u8,
}

impl Default for SpectroOptions {
    fn default() -> Self {
        Self {
            wl: 512,
            win_fun: "hanning".into(),
            overlap_pct: DEFAULT_OVERLAP,
            normalized: false,
            amplitude_correction: true,
            noise_red: 0,
        }
    }
}

pub fn window_length_from_freq_res(sample_rate: u32, freq_res: f64) -> usize {
    let mut wl = (sample_rate as f64 / freq_res).round() as usize;
    if wl % 2 == 1 {
        wl += 1;
    }
    wl.max(2)
}

pub fn compute_spectrogram(samples: &[f64], sample_rate: u32, opts: &SpectroOptions) -> Spectrogram {
    let wl = opts.wl.max(2);
    let win = window::window(&opts.win_fun, wl);
    let step = ((wl as f64) * (1.0 - opts.overlap_pct / 100.0)).max(1.0) as usize;
    let n_frames = if samples.len() >= wl {
        1 + (samples.len().saturating_sub(wl)) / step
    } else {
        0
    };

    let n_bins = wl / 2;
    let freqs_khz: Vec<f64> = (0..n_bins)
        .map(|k| k as f64 * sample_rate as f64 / wl as f64 / 1000.0)
        .collect();

    let correction = if opts.amplitude_correction {
        2.0 / wl as f64
    } else {
        1.0
    };

    // Parallel STFT over time frames; scatter into row-major matrix afterward.
    let frames: Vec<Vec<f64>> = if n_frames > 0 {
        (0..n_frames)
            .into_par_iter()
            .map(|frame_idx| {
                let frame_start = frame_idx * step;
                let mut frame_bins = vec![0.0; n_bins];
                FFT_CTX.with(|ctx| {
                    let mut ctx = ctx.borrow_mut();
                    if ctx.as_ref().map_or(true, |c| c.wl != wl) {
                        *ctx = Some(FftScratch::for_wl(wl));
                    }
                    let scratch = ctx.as_mut().unwrap();
                    scratch.process_frame(samples, frame_start, &win, correction, &mut frame_bins);
                });
                frame_bins
            })
            .collect()
    } else {
        Vec::new()
    };

    let mut data = vec![0.0; n_bins * n_frames.max(1)];
    for (frame_idx, frame_bins) in frames.iter().enumerate() {
        for (k, &v) in frame_bins.iter().enumerate() {
            data[k * n_frames + frame_idx] = v;
        }
    }

    let mut spec = Spectrogram {
        data,
        n_bins,
        n_frames,
        freqs_khz,
        sample_rate,
        wl,
    };

    if opts.noise_red == 1 {
        noise_reduce_rows(&mut spec);
    } else if opts.noise_red == 2 {
        noise_reduce_cols(&mut spec);
    }

    if opts.normalized {
        normalize_spec(&mut spec);
    }

    spec
}

fn noise_reduce_rows(spec: &mut Spectrogram) {
    for bin in 0..spec.n_bins {
        let row = spec_row_mut(spec, bin);
        let mut sorted = row.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = sorted[sorted.len() / 2];
        for v in row.iter_mut() {
            *v -= median;
        }
    }
}

fn noise_reduce_cols(spec: &mut Spectrogram) {
    for col in 0..spec.n_frames {
        let mut col_vals: Vec<f64> = (0..spec.n_bins)
            .map(|b| spec.data[b * spec.n_frames + col])
            .collect();
        col_vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = col_vals[col_vals.len() / 2];
        for b in 0..spec.n_bins {
            spec.data[b * spec.n_frames + col] -= median;
        }
    }
}

fn normalize_spec(spec: &mut Spectrogram) {
    let max_val = spec.data.iter().copied().fold(0.0_f64, f64::max);
    if max_val > 0.0 {
        for v in spec.data.iter_mut() {
            *v /= max_val;
        }
    }
}

fn spec_row_mut(spec: &mut Spectrogram, bin: usize) -> &mut [f64] {
    let start = bin * spec.n_frames;
    &mut spec.data[start..start + spec.n_frames]
}

pub fn to_dbfs_matrix(spec: &Spectrogram, amp_max: f64) -> Vec<Vec<f64>> {
    spec.rows()
        .map(|row| {
            row.iter()
                .map(|&v| 20.0 * (v.abs() / amp_max).log10())
                .collect()
        })
        .collect()
}

/// Find row indices for frequency range (matches R which.abs logic on kHz axis).
pub fn freq_row_range(spec: &Spectrogram, min_hz: f64, max_hz: f64) -> (usize, usize) {
    let min_khz = min_hz / 1000.0;
    let max_khz = max_hz / 1000.0;

    let mut min_row = 0;
    let mut min_diff = f64::MAX;
    for (i, &f) in spec.freqs_khz.iter().enumerate() {
        let d = (f - min_khz).abs();
        if d < min_diff {
            min_diff = d;
            min_row = i;
        }
    }

    let mut max_row = spec.freqs_khz.len().saturating_sub(1);
    let mut max_diff = f64::MAX;
    for (i, &f) in spec.freqs_khz.iter().enumerate() {
        let d = (f - max_khz).abs();
        if d < max_diff {
            max_diff = d;
            max_row = i;
        }
    }

    max_row = max_row.min(spec.n_bins.saturating_sub(1));
    (min_row, max_row)
}

/// Welch PSD for one segment — matches oce::pwelch one-sided output length nfft/2.
pub fn pwelch_segment(samples: &[f64], fs: u32, nfft: usize) -> Vec<f64> {
    let win = window::hanning(nfft);
    let mut planner = RealFftPlanner::<f64>::new();
    let r2c = planner.plan_fft_forward(nfft);
    let mut indata = vec![0.0; nfft];
    let mut outdata = r2c.make_output_vec();

    for (i, &w) in win.iter().enumerate() {
        indata[i] = samples.get(i).copied().unwrap_or(0.0) * w;
    }
    r2c.process(&mut indata, &mut outdata).unwrap();

    let n_out = nfft / 2;
    let scale = 1.0 / (fs as f64 * win.iter().map(|w| w * w).sum::<f64>());

    (0..n_out)
        .map(|k| outdata[k].norm_sqr() * scale)
        .collect()
}
