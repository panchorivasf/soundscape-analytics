use crate::dsp::{normalize_proportions, shannon_entropy};
use crate::indices::bands::{diversity_bands, hz_band_rows};
use crate::types::IndexParams;

pub fn adi_from_db_spec(spec: &[Vec<f64>], params: &IndexParams, nyquist: f64) -> f64 {
    let props = adi_band_proportions(spec, params, nyquist);
    let props = normalize_proportions(&props);
    (shannon_entropy(&props) * 1000.0).round() / 1000.0
}

/// Raw band activity proportions used by ADI (before Shannon normalization).
pub fn adi_band_proportions(spec: &[Vec<f64>], params: &IndexParams, nyquist: f64) -> Vec<f64> {
    match params.prop_den {
        1 => band_proportions_within_band(spec, params, nyquist),
        _ => adi_band_proportions_across_range(spec, params, nyquist),
    }
}

pub fn band_proportions_within_band(
    spec: &[Vec<f64>],
    params: &IndexParams,
    nyquist: f64,
) -> Vec<f64> {
    let bands = diversity_bands(params, nyquist);
    let freq_per_row = params.freq_res;
    let cutoff = params.cutoff;

    bands
        .iter()
        .enumerate()
        .map(|(j, (min_hz, max_hz))| {
            let is_last = j == bands.len().saturating_sub(1);
            let (miny, maxy) = hz_band_rows(*min_hz, *max_hz, freq_per_row, spec.len(), is_last);
            if miny > maxy || miny >= spec.len() {
                return 0.0;
            }
            let band_above = spec[miny..=maxy]
                .iter()
                .flat_map(|r| r.iter())
                .filter(|&&v| v > cutoff)
                .count();
            let band_total = spec[miny..=maxy].iter().flat_map(|r| r.iter()).count();
            if band_total == 0 {
                0.0
            } else {
                band_above as f64 / band_total as f64
            }
        })
        .collect()
}

fn adi_band_proportions_across_range(
    spec: &[Vec<f64>],
    params: &IndexParams,
    nyquist: f64,
) -> Vec<f64> {
    let bands = diversity_bands(params, nyquist);
    let freq_per_row = params.freq_res;
    let cutoff = params.cutoff;

    let overall_min = bands.first().map(|(m, _)| *m).unwrap_or(params.min_freq);
    let overall_max = bands
        .last()
        .map(|(_, mx)| *mx)
        .unwrap_or(params.max_freq.unwrap_or(10_000.0).min(nyquist));

    let minspec = (overall_min / freq_per_row).round() as usize;
    let maxspec = (overall_max / freq_per_row).round() as usize;
    let minspec = minspec.min(spec.len().saturating_sub(1));
    let maxspec = maxspec.min(spec.len().saturating_sub(1));

    let total_values: usize = if minspec <= maxspec && maxspec < spec.len() {
        spec[minspec..=maxspec]
            .iter()
            .flat_map(|r| r.iter())
            .filter(|&&v| v > cutoff)
            .count()
    } else {
        0
    };

    bands
        .iter()
        .enumerate()
        .map(|(j, (min_hz, max_hz))| {
            let is_last = j == bands.len().saturating_sub(1);
            let (miny, maxy) = hz_band_rows(*min_hz, *max_hz, freq_per_row, spec.len(), is_last);
            if miny > maxy || miny >= spec.len() {
                return 0.0;
            }
            let above = spec[miny..=maxy]
                .iter()
                .flat_map(|r| r.iter())
                .filter(|&&v| v > cutoff)
                .count();
            if total_values == 0 {
                0.0
            } else {
                above as f64 / total_values as f64
            }
        })
        .collect()
}

/// ADI/AEI band frequency ranges in Hz.
pub fn adi_band_ranges_hz(
    _spec_len: usize,
    params: &IndexParams,
    nyquist: f64,
    _freq_bins: &[f64],
) -> Vec<(f64, f64)> {
    diversity_bands(params, nyquist)
}
