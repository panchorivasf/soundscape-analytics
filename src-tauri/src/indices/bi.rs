use crate::audio::Wave;
use crate::dsp::spectrogram::{compute_spectrogram, SpectroOptions};
use crate::dsp::{mean_db};
use crate::types::{IndexParams, IndexResult};

fn bi_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> f64 {
    let mut w_len = params.w_len as usize;
    if w_len % 2 == 1 {
        w_len += 1;
    }
    let nyquist = wave.nyquist();
    let mut max_freq = params.bi_max_freq.min(nyquist);
    let min_freq = params.bi_min_freq.max(0.0);
    if max_freq > nyquist {
        max_freq = nyquist;
    }

    let spec = compute_spectrogram(
        samples,
        wave.sample_rate,
        &SpectroOptions {
            wl: w_len,
            win_fun: params.win_fun.clone(),
            normalized: params.norm_spec,
            amplitude_correction: false,
            noise_red: params.noise_red,
            ..Default::default()
        },
    );

    let mean_spectrum: Vec<f64> = if params.norm_spec {
        spec.rows().map(mean_db).collect()
    } else {
        spec.rows()
            .map(|row| {
                let db: Vec<f64> = row
                    .iter()
                    .map(|&v| 20.0 * (v.abs() / wave.amp_max_bi()).log10())
                    .collect();
                mean_db(&db)
            })
            .collect()
    };

    let rows_width = mean_spectrum.len() as f64 / nyquist;
    let min_row = (min_freq * rows_width) as usize;
    let max_row = (max_freq * rows_width) as usize;
    let max_row = max_row.min(mean_spectrum.len().saturating_sub(1));
    if min_row > max_row {
        return 0.0;
    }

    let segment = &mean_spectrum[min_row..=max_row];
    let min_val = segment.iter().copied().fold(f64::INFINITY, f64::min);
    segment.iter().map(|&v| (v - min_val) * rows_width).sum()
}

pub fn compute_bi_from_prepared(
    wave: &Wave,
    mut base: IndexResult,
    params: &IndexParams,
    left: &[f64],
    right: Option<&[f64]>,
) -> IndexResult {
    if wave.is_stereo() {
        if let Some(r) = right {
            let vl = bi_channel(left, wave, params);
            let vr = bi_channel(r, wave, params);
            base.value_l = Some(vl);
            base.value_r = Some(vr);
            base.value_avg = Some((vl + vr) / 2.0);
        }
    } else {
        base.value = Some(bi_channel(left, wave, params));
    }
    base
}
