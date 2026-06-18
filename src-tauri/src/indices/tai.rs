use crate::audio::Wave;
use crate::dsp::binary::spectrogram_cutoff;
use crate::dsp::filter::highpass;
use crate::types::IndexParams;

pub struct TaiValues {
    pub value: f64,
    pub value_a2k: f64,
    pub lowf_noise: f64,
    pub midf_noise: f64,
}

pub fn tai_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> TaiValues {
    let mut s = samples.to_vec();
    if params.hpf > 0.0 {
        s = highpass(&s, wave.sample_rate, params.hpf);
    }

    let matrix = spectrogram_cutoff(
        &s,
        wave.sample_rate,
        wave,
        params.freq_res,
        params.cutoff,
        0,
    );

    let n_rows = matrix.len();
    let n_cols = matrix.first().map(|r| r.len()).unwrap_or(0);
    if n_rows == 0 || n_cols == 0 {
        return TaiValues {
            value: 0.0,
            value_a2k: 0.0,
            lowf_noise: 0.0,
            midf_noise: 0.0,
        };
    }

    let j = (n_cols as f64 / params.n_windows as f64).round() as usize;
    let j = j.max(1);

    let mut trill_spectral = vec![vec![0.0; n_cols]; n_rows];

    for freq_idx in 0..n_rows {
        let mut col = 0usize;
        while col < n_cols {
            let end = (col + j).min(n_cols);
            let window = &matrix[freq_idx][col..end];
            if window.iter().any(|v| v.is_nan()) {
                for c in col..end {
                    trill_spectral[freq_idx][c] = 0.0;
                }
            } else {
                let score: f64 = window
                    .windows(2)
                    .map(|w| (w[1] - w[0]).abs())
                    .sum();
                let fill = if window.len() >= j / 2 { score } else { 0.0 };
                for c in col..end {
                    trill_spectral[freq_idx][c] = fill;
                }
            }
            col += j;
        }
    }

    let trill_mean: Vec<f64> = trill_spectral
        .iter()
        .map(|row| row.iter().sum::<f64>() / row.len() as f64)
        .collect();

    let low_end = 10.min(n_rows);
    let mid_end = 20.min(n_rows);

    let low_freq_means: Vec<f64> = (0..n_cols)
        .map(|c| {
            trill_spectral[..low_end]
                .iter()
                .map(|row| row[c])
                .sum::<f64>()
                / low_end as f64
        })
        .collect();

    let mid_freq_means: Vec<f64> = if mid_end > low_end {
        (0..n_cols)
            .map(|c| {
                trill_spectral[low_end..mid_end]
                    .iter()
                    .map(|row| row[c])
                    .sum::<f64>()
                    / (mid_end - low_end) as f64
            })
            .collect()
    } else {
        vec![0.0; n_cols]
    };

    let high_mean = if n_rows > mid_end {
        (0..n_cols)
            .map(|c| {
                trill_spectral[mid_end..]
                    .iter()
                    .map(|row| row[c])
                    .sum::<f64>()
                    / (n_rows - mid_end) as f64
            })
            .sum::<f64>()
            / n_cols as f64
    } else {
        0.0
    };

    let low_noisy = low_freq_means.iter().filter(|&&m| m >= 10.0).count();
    let mid_noisy = mid_freq_means.iter().filter(|&&m| m >= 10.0).count();

    TaiValues {
        value: ((trill_mean.iter().sum::<f64>() / trill_mean.len() as f64) * 1000.0).round()
            / 1000.0,
        value_a2k: (high_mean * 10.0).round() / 10.0,
        lowf_noise: ((low_noisy as f64 / n_cols as f64) * 100.0).round(),
        midf_noise: ((mid_noisy as f64 / n_cols as f64) * 100.0).round(),
    }
}
