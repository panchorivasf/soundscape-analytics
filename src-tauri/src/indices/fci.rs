use crate::audio::Wave;
use crate::dsp::binary::{band_row_indices, freq_bins_hz, spectrogram_binary};
use crate::types::IndexParams;

pub struct FciValues {
    pub lfc: f64,
    pub mfc: f64,
    pub hfc: f64,
    pub ufc: f64,
}

fn fci_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> FciValues {
    let binary = spectrogram_binary(samples, wave.sample_rate, wave, params.freq_res, params.cutoff);
    let n_rows = binary.len();
    let n_cols = binary.first().map(|r| r.len()).unwrap_or(0);
    if n_rows == 0 || n_cols == 0 {
        return FciValues {
            lfc: 0.0,
            mfc: 0.0,
            hfc: 0.0,
            ufc: 0.0,
        };
    }

    let mut uf_max = params.uf_max;
    let nyquist = wave.nyquist();
    if uf_max > nyquist {
        uf_max = nyquist;
    }

    let freq_bins = freq_bins_hz(n_rows, wave.sample_rate);
    let total = (n_cols as f64).max(1.0);

    let cover = |indices: &[usize]| -> f64 {
        if indices.is_empty() {
            return 0.0;
        }
        let active: usize = indices
            .iter()
            .map(|&r| binary[r].iter().filter(|&&b| b).count())
            .sum();
        round6(active as f64 / (indices.len() as f64 * total))
    };

    FciValues {
        lfc: cover(&band_row_indices(&freq_bins, params.lf_min, params.lf_max, true)),
        mfc: cover(&band_row_indices(&freq_bins, params.mf_min, params.mf_max, false)),
        hfc: cover(&band_row_indices(&freq_bins, params.hf_min, params.hf_max, false)),
        ufc: cover(&band_row_indices(&freq_bins, params.uf_min, uf_max, false)),
    }
}

fn round6(v: f64) -> f64 {
    (v * 1_000_000.0).round() / 1_000_000.0
}

pub fn compute_fci(
    wave: &Wave,
    left: &[f64],
    right: Option<&[f64]>,
    params: &IndexParams,
) -> (Option<FciValues>, Option<FciValues>) {
    let l = fci_channel(left, wave, params);
    let r = right.map(|s| fci_channel(s, wave, params));
    (Some(l), r)
}
