use crate::audio::Wave;
use crate::dsp::spectrogram::{compute_spectrogram, to_dbfs_matrix, SpectroOptions, window_length_from_freq_res};

/// Binary spectrogram: 1 where dBFS > cutoff (matches spectrogram_binary).
pub fn spectrogram_binary(
    samples: &[f64],
    sample_rate: u32,
    wave: &Wave,
    freq_res: f64,
    cutoff: f64,
) -> Vec<Vec<bool>> {
    let wl = window_length_from_freq_res(sample_rate, freq_res);
    let spec = compute_spectrogram(
        samples,
        sample_rate,
        &SpectroOptions {
            wl,
            amplitude_correction: true,
            ..Default::default()
        },
    );
    let db = to_dbfs_matrix(&spec, wave.amp_max_bi());
    db.iter()
        .map(|row| row.iter().map(|&v| v > cutoff).collect())
        .collect()
}

/// dBFS spectrogram with values below cutoff set to NaN (matches spectrogram_cutoff).
pub fn spectrogram_cutoff(
    samples: &[f64],
    sample_rate: u32,
    wave: &Wave,
    freq_res: f64,
    cutoff: f64,
    noise_red: u8,
) -> Vec<Vec<f64>> {
    let wl = window_length_from_freq_res(sample_rate, freq_res);
    let spec = compute_spectrogram(
        samples,
        sample_rate,
        &SpectroOptions {
            wl,
            amplitude_correction: true,
            noise_red,
            ..Default::default()
        },
    );
    let db = to_dbfs_matrix(&spec, wave.amp_max());
    db.iter()
        .map(|row| {
            row.iter()
                .map(|&v| if v < cutoff { f64::NAN } else { v })
                .collect()
        })
        .collect()
}

/// Power dB spectrogram (10*log10(amp^2)) for FADI.
pub fn spectrogram_power_db(
    samples: &[f64],
    sample_rate: u32,
    wl: usize,
) -> Vec<Vec<f64>> {
    let spec = compute_spectrogram(
        samples,
        sample_rate,
        &SpectroOptions {
            wl,
            amplitude_correction: true,
            ..Default::default()
        },
    );
    spec.rows()
        .map(|row| row.iter().map(|&v| 10.0 * (v * v).log10()).collect())
        .collect()
}

/// Frequency bin center values in Hz (matches R seq(0, nyquist, length.out = n_bins)).
pub fn freq_bins_hz(n_bins: usize, sample_rate: u32) -> Vec<f64> {
    let nyquist = sample_rate as f64 / 2.0;
    if n_bins <= 1 {
        return vec![0.0];
    }
    (0..n_bins)
        .map(|i| i as f64 * nyquist / (n_bins - 1) as f64)
        .collect()
}

pub fn band_row_indices(freq_bins: &[f64], min_hz: f64, max_hz: f64, inclusive_min: bool) -> Vec<usize> {
    freq_bins
        .iter()
        .enumerate()
        .filter(|(_, &f)| {
            if inclusive_min {
                f >= min_hz && f <= max_hz
            } else {
                f > min_hz && f <= max_hz
            }
        })
        .map(|(i, _)| i)
        .collect()
}
