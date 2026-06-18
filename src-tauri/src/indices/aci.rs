use crate::audio::Wave;
use crate::dsp::spectrogram::{freq_row_range, Spectrogram};
use crate::types::{IndexParams, IndexResult};

fn aci_from_spec(spec: &Spectrogram, params: &IndexParams, duration: f64) -> f64 {
    let j = params.j.unwrap_or(duration);
    let min_freq = params.aci_min_freq;
    let max_freq = params
        .aci_max_freq
        .or(params.max_freq)
        .unwrap_or(spec.sample_rate as f64 / 2.0)
        .min(spec.sample_rate as f64 / 2.0);

    let (min_row, max_row) = freq_row_range(spec, min_freq, max_freq);
    let n_rows = max_row + 1 - min_row;
    let n_frames = spec.n_frames;
    if n_rows == 0 || n_frames == 0 {
        return 0.0;
    }

    let delta_tk = duration / n_frames as f64;
    let i_per_j = (j / delta_tk).floor() as usize;
    let no_j = (duration / j).floor() as usize;

    let mut total = 0.0;
    for bin in min_row..=max_row {
        let row = spec.row(bin);
        let mut row_sum = 0.0;
        for j_idx in 0..no_j {
            let min_col = j_idx * i_per_j;
            let max_col = ((j_idx + 1) * i_per_j).min(row.len()).saturating_sub(1);
            if max_col <= min_col {
                continue;
            }
            let mut d = 0.0;
            for k in min_col..max_col {
                d += (row[k] - row[k + 1]).abs();
            }
            let sum_i: f64 = row[min_col..=max_col].iter().sum();
            if sum_i > 0.0 {
                row_sum += d / sum_i;
            }
        }
        total += row_sum;
    }
    total
}

pub fn compute_aci_from_prepared(
    wave: &Wave,
    mut base: IndexResult,
    params: &IndexParams,
    left: Option<&Spectrogram>,
    right: Option<&Spectrogram>,
) -> IndexResult {
    let duration = wave.duration();
    if wave.is_stereo() {
        if let (Some(l), Some(r)) = (left, right) {
            let vl = aci_from_spec(l, params, duration);
            let vr = aci_from_spec(r, params, duration);
            base.value_l = Some(vl);
            base.value_r = Some(vr);
            base.value_avg = Some((vl + vr) / 2.0);
        }
    } else if let Some(l) = left {
        base.value = Some(aci_from_spec(l, params, duration));
    }
    base
}
