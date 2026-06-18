use crate::audio::Wave;
use crate::dsp::welch::mean_spectrum;
use crate::dsp::{frobenius_norm, trapz};
use crate::types::{IndexParams, IndexResult};

fn ndsi_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> f64 {
    let mut w_len = params.w_len as usize;
    if w_len % 2 == 1 {
        w_len += 1;
    }
    let nyquist = wave.nyquist();
    let duration = wave.duration();

    let spec = mean_spectrum(samples, wave.sample_rate, w_len, duration);
    let spec_rows = spec.len();
    let freq_per_row = spec_rows as f64 / nyquist;

    let hz_interval = params.anthro_max - params.anthro_min;
    let anthro_vals_range = params.anthro_max - params.anthro_min;
    let bio_vals_range = params.bio_max - params.bio_min;

    let n_anthro = (anthro_vals_range / hz_interval).round() as usize;
    let n_bio = (bio_vals_range / hz_interval).round() as usize;

    let anthro_min_row = (params.anthro_min * freq_per_row).round() as usize;
    let anthro_max_row = (params.anthro_max * freq_per_row).round() as usize;
    let bio_step = freq_per_row * (bio_vals_range / n_bio.max(1) as f64);
    let mut bio_min_row = (params.bio_min * freq_per_row).round() as usize;
    let mut bio_max_row = bio_min_row + bio_step.round() as usize;

    let mut anthro_bins = vec![0.0; n_anthro.max(1)];
    let mut bio_bins = vec![0.0; n_bio.max(1)];

    for bin in anthro_bins.iter_mut() {
        let end = anthro_max_row.min(spec_rows.saturating_sub(1));
        if anthro_min_row <= end {
            *bin = trapz(&spec[anthro_min_row..=end]);
        }
    }

    for bin in bio_bins.iter_mut() {
        if bio_max_row >= spec_rows {
            bio_max_row = spec_rows.saturating_sub(1);
        }
        if bio_min_row <= bio_max_row && bio_max_row < spec_rows {
            *bin = trapz(&spec[bio_min_row..=bio_max_row]);
        }
        bio_min_row += bio_step.round() as usize;
        bio_max_row += bio_step.round() as usize;
    }

    let mut freqbins: Vec<f64> = anthro_bins;
    freqbins.extend_from_slice(&bio_bins);

    let norm = frobenius_norm(&freqbins);
    if norm > 0.0 {
        for v in freqbins.iter_mut() {
            *v /= norm;
        }
    }

    let sum_bio: f64 = freqbins.iter().skip(1).sum();
    let anthro = freqbins.first().copied().unwrap_or(0.0);

    if sum_bio + anthro == 0.0 {
        0.0
    } else {
        (sum_bio - anthro) / (sum_bio + anthro)
    }
}

pub fn compute_ndsi_from_prepared(
    wave: &Wave,
    mut base: IndexResult,
    params: &IndexParams,
    left: &[f64],
    right: Option<&[f64]>,
) -> IndexResult {
    let nyquist = wave.nyquist();
    if params.bio_max > nyquist {
        base.error = Some(format!(
            "bio.max ({}) exceeds Nyquist ({nyquist})",
            params.bio_max
        ));
        return base;
    }
    if params.anthro_max > params.bio_min {
        base.error = Some("anthro.max cannot exceed bio.min".into());
        return base;
    }

    if wave.is_stereo() {
        if let Some(r) = right {
            let vl = ndsi_channel(left, wave, params);
            let vr = ndsi_channel(r, wave, params);
            base.value_l = Some(vl);
            base.value_r = Some(vr);
            base.value_avg = Some((vl + vr) / 2.0);
        }
    } else {
        base.value = Some(ndsi_channel(left, wave, params));
    }
    base
}
