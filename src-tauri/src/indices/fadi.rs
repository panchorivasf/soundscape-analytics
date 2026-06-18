use crate::audio::Wave;
use crate::dsp::binary::spectrogram_power_db;
use crate::dsp::spectrogram::window_length_from_freq_res;
use crate::indices::bands::diversity_bands;
use crate::types::IndexParams;

const FADI_FREQ_PER_ROW: f64 = 10.0;

pub fn fadi_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> Result<f64, String> {
    if params.nem == 2 && wave.duration() < 30.0 {
        return Err("FADI NEM=2 requires recordings of at least 30 seconds".into());
    }

    let wl = window_length_from_freq_res(wave.sample_rate, FADI_FREQ_PER_ROW);
    let bands = diversity_bands(params, wave.nyquist());
    if bands.is_empty() {
        return Ok(0.0);
    }
    let max_freq = bands.iter().map(|(_, mx)| *mx).fold(0.0, f64::max);
    let band_min_hz = bands.iter().map(|(mn, _)| *mn).fold(f64::INFINITY, f64::min);

    let spec = spectrogram_power_db(samples, wave.sample_rate, wl);
    let freq_per_row = FADI_FREQ_PER_ROW;

    let noise_db = if params.nem == 1 {
        return Err("FADI NEM=1 (noise file) is not yet supported in the desktop app".into());
    } else {
        noise_estimation_histogram(&spec, max_freq, freq_per_row)
    };

    let threshold = floating_threshold(
        &spec,
        &noise_db,
        params,
        max_freq,
        band_min_hz,
        freq_per_row,
    );

    let scorez: Vec<f64> = bands
        .iter()
        .map(|(min_hz, max_hz)| band_score(&spec, *min_hz, *max_hz, &threshold, freq_per_row))
        .collect();

    let sum: f64 = scorez.iter().sum();
    if sum == 0.0 {
        return Ok(0.0);
    }
    let score: Vec<f64> = scorez.iter().map(|&s| s / sum).collect();
    let shannon: f64 = -score
        .iter()
        .map(|&p| p * (p + 1e-7).ln())
        .sum::<f64>();

    Ok((shannon * 1_000_000.0).round() / 1_000_000.0)
}

fn noise_estimation_histogram(spec: &[Vec<f64>], max_f: f64, freq_row: f64) -> Vec<f64> {
    let maxy = (max_f / freq_row).round() as usize;
    let maxy = maxy.min(spec.len());
    let mut noise_db = vec![0.0; maxy];
    for j in 0..maxy {
        let row = &spec[j];
        noise_db[j] = histogram_mode(row);
    }
    noise_db
}

fn histogram_mode(row: &[f64]) -> f64 {
    if row.is_empty() {
        return 0.0;
    }
    let min_v = row.iter().copied().fold(f64::INFINITY, f64::min);
    let max_v = row.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if (max_v - min_v).abs() < 1e-12 {
        return min_v;
    }
    let n_bins = 40;
    let mut counts = vec![0u32; n_bins];
    let step = (max_v - min_v) / n_bins as f64;
    for &v in row {
        let mut idx = ((v - min_v) / step).floor() as usize;
        if idx >= n_bins {
            idx = n_bins - 1;
        }
        counts[idx] += 1;
    }
    let max_count = counts.iter().copied().max().unwrap_or(0);
    let idx = counts.iter().position(|&c| c == max_count).unwrap_or(0);
    min_v + (idx as f64 + 0.5) * step
}

fn floating_threshold(
    spec: &[Vec<f64>],
    noise: &[f64],
    params: &IndexParams,
    max_f: f64,
    min_hz: f64,
    freq_row: f64,
) -> Vec<f64> {
    let miny = (min_hz / freq_row).round() as usize;
    let maxy = (max_f / freq_row).round() as usize;
    let miny = miny.min(spec.len().saturating_sub(1));
    let maxy = maxy.min(spec.len().saturating_sub(1));

    let global_max = spec[miny..=maxy]
        .iter()
        .flat_map(|r| r.iter())
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let global_threshold = global_max + params.threshold_fixed;

    let n = noise.len().max(maxy + 1);
    let mut out = vec![global_threshold; n];
    for j in 0..=maxy {
        let floating = noise.get(j).copied().unwrap_or(0.0) + params.gamma;
        out[j] = floating.max(global_threshold);
    }
    out
}

fn band_score(
    spec: &[Vec<f64>],
    minf: f64,
    maxf: f64,
    threshold: &[f64],
    freq_row: f64,
) -> f64 {
    let miny = (minf / freq_row).round() as usize;
    let maxy = (maxf / freq_row).round() as usize;
    if miny >= spec.len() {
        return 0.0;
    }
    let maxy = maxy.min(spec.len().saturating_sub(1));
    if miny + 1 > maxy {
        return 0.0;
    }

    let mut above = 0usize;
    let mut total = 0usize;
    for m in (miny + 1)..=maxy {
        if m >= spec.len() {
            break;
        }
        let thr = threshold.get(m).copied().unwrap_or(f64::INFINITY);
        for &v in &spec[m] {
            total += 1;
            if v > thr {
                above += 1;
            }
        }
    }
    if total == 0 {
        0.0
    } else {
        above as f64 / total as f64
    }
}
