pub mod binary;
pub mod filter;
pub mod spectrogram;
pub mod welch;
pub mod window;

use crate::audio::Wave;

/// Remove DC offset (mean) from samples — matches seewave::rmoffset.
pub fn remove_dc_offset(samples: &mut [f64]) {
    if samples.is_empty() {
        return;
    }
    let mean: f64 = samples.iter().sum::<f64>() / samples.len() as f64;
    for s in samples.iter_mut() {
        *s -= mean;
    }
}

pub fn prepare_channel(wave: &Wave, channel: crate::audio::Channel, rm_offset: bool) -> Vec<f64> {
    let mut samples = wave.channel(channel);
    if rm_offset {
        remove_dc_offset(&mut samples);
    }
    samples
}

/// Subtract median from each row (freq bin) of a spectrogram matrix.
pub fn noise_reduce_rows(spec: &mut [Vec<f64>]) {
    for row in spec.iter_mut() {
        let mut sorted = row.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = if sorted.is_empty() {
            0.0
        } else {
            sorted[sorted.len() / 2]
        };
        for v in row.iter_mut() {
            *v -= median;
        }
    }
}

/// Subtract median from each column (time frame) of a spectrogram matrix.
pub fn noise_reduce_cols(spec: &mut [Vec<f64>]) {
    if spec.is_empty() {
        return;
    }
    let n_cols = spec[0].len();
    for c in 0..n_cols {
        let mut col: Vec<f64> = spec.iter().map(|row| row[c]).collect();
        col.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = col[col.len() / 2];
        for row in spec.iter_mut() {
            row[c] -= median;
        }
    }
}

pub fn to_dbfs(spec: &mut [Vec<f64>], amp_max: f64) {
    for row in spec.iter_mut() {
        for v in row.iter_mut() {
            *v = 20.0 * (v.abs() / amp_max).log10();
        }
    }
}

pub fn to_power_db(spec: &mut [Vec<f64>]) {
    for row in spec.iter_mut() {
        for v in row.iter_mut() {
            let x = *v;
            *v = 10.0 * (x * x).log10();
        }
    }
}

pub fn normalize_spec(spec: &mut [Vec<f64>]) {
    let max_val = spec
        .iter()
        .flat_map(|r| r.iter())
        .copied()
        .fold(0.0_f64, f64::max);
    if max_val > 0.0 {
        for row in spec.iter_mut() {
            for v in row.iter_mut() {
                *v /= max_val;
            }
        }
    }
}

/// Mean in dB domain (seewave::meandB).
pub fn mean_db(row: &[f64]) -> f64 {
    if row.is_empty() {
        return 0.0;
    }
    row.iter().sum::<f64>() / row.len() as f64
}

pub fn normalize_proportions(score: &[f64]) -> Vec<f64> {
    let total: f64 = score.iter().sum();
    if total == 0.0 {
        score.to_vec()
    } else {
        score.iter().map(|&s| s / total).collect()
    }
}

pub fn shannon_entropy(proportions: &[f64]) -> f64 {
    proportions
        .iter()
        .filter(|&&p| p > 0.0)
        .map(|&p| -p * p.ln())
        .sum()
}

pub fn gini_coefficient(mut values: Vec<f64>) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = values.len() as f64;
    if n == 0.0 {
        return 0.0;
    }
    let sum: f64 = values.iter().sum();
    if sum == 0.0 {
        return 0.0;
    }
    let weighted: f64 = values
        .iter()
        .enumerate()
        .map(|(i, &v)| (i as f64 + 1.0) * v)
        .sum();
    (2.0 * weighted) / (n * sum) - (n + 1.0) / n
}

pub fn trapz(y: &[f64]) -> f64 {
    if y.len() < 2 {
        return y.first().copied().unwrap_or(0.0);
    }
    let mut sum = 0.0;
    for i in 0..y.len() - 1 {
        sum += (y[i] + y[i + 1]) / 2.0;
    }
    sum
}

pub fn frobenius_norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}
