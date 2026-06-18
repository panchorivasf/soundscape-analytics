use crate::types::{BandRange, IndexParams};

/// Hz ranges for ADI, AEI, and FADI (shared configuration).
pub fn diversity_bands(params: &IndexParams, nyquist: f64) -> Vec<(f64, f64)> {
    if !params.div_band_ranges.is_empty() {
        return params
            .div_band_ranges
            .iter()
            .map(|b| (b.min_hz.max(0.0), b.max_hz.min(nyquist)))
            .collect();
    }
    let max_freq = params.max_freq.unwrap_or(10_000.0).min(nyquist);
    let min_freq = params.min_freq;
    let n = params.n_bands.max(1) as usize;
    standard_div_band_ranges(n as u32, min_freq)
        .into_iter()
        .map(|b| (b.min_hz.max(0.0), b.max_hz.min(max_freq)))
        .collect()
}

pub fn standard_div_band_ranges(n_bands: u32, low_cut_hz: f64) -> Vec<BandRange> {
    let n = n_bands.max(1) as usize;
    (0..n)
        .map(|i| {
            let min_hz = if i == 0 {
                low_cut_hz
            } else {
                i as f64 * 1000.0
            };
            BandRange {
                min_hz,
                max_hz: (i + 1) as f64 * 1000.0,
            }
        })
        .collect()
}

pub fn default_div_band_ranges(n_bands: u32, min_hz: f64, max_hz: f64) -> Vec<BandRange> {
    let n = n_bands.max(1) as usize;
    let width = (max_hz - min_hz) / n as f64;
    (0..n)
        .map(|j| BandRange {
            min_hz: min_hz + j as f64 * width,
            max_hz: min_hz + (j + 1) as f64 * width,
        })
        .collect()
}

/// Map an Hz band to inclusive spectrogram row indices (freq_res rows).
pub fn hz_band_rows(
    min_hz: f64,
    max_hz: f64,
    freq_per_row: f64,
    spec_len: usize,
    is_last: bool,
) -> (usize, usize) {
    if spec_len == 0 {
        return (0, 0);
    }
    let mut miny = (min_hz / freq_per_row).round() as usize;
    let mut maxy = if is_last {
        (max_hz / freq_per_row).round() as usize
    } else {
        let edge = (max_hz / freq_per_row).floor() as usize;
        if edge == 0 {
            0
        } else {
            edge.saturating_sub(1)
        }
    };
    miny = miny.min(spec_len.saturating_sub(1));
    maxy = maxy.min(spec_len.saturating_sub(1));
    if miny > maxy {
        maxy = miny;
    }
    (miny, maxy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_ten_bands() {
        let bands = standard_div_band_ranges(10, 200.0);
        assert_eq!(bands.len(), 10);
        assert_eq!(bands[0].min_hz, 200.0);
        assert_eq!(bands[0].max_hz, 1000.0);
        assert_eq!(bands[1].min_hz, 1000.0);
        assert_eq!(bands[1].max_hz, 2000.0);
        assert_eq!(bands[9].max_hz, 10_000.0);
    }
}
