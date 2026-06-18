use crate::audio::Wave;
use crate::dsp::binary::{freq_bins_hz, spectrogram_cutoff};
use crate::dsp::filter::highpass;
use crate::types::IndexParams;

pub struct BbaiValues {
    pub value: f64,
    pub n_clicks: u32,
    pub prop_clicks: f64,
    pub click_rate: f64,
    pub mean_length: f64,
}

pub struct BbaiDetail {
    pub values: BbaiValues,
    pub click_matrix: Vec<Vec<bool>>,
}

pub fn bbai_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> BbaiValues {
    bbai_channel_detail(samples, wave, params).values
}

pub fn bbai_channel_detail(samples: &[f64], wave: &Wave, params: &IndexParams) -> BbaiDetail {
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
        1, // noise.red = "rows" in R
    );

    let n_freq = matrix.len();
    let n_time = matrix.first().map(|r| r.len()).unwrap_or(0);
    if n_freq == 0 || n_time == 0 {
        return BbaiDetail {
            values: BbaiValues {
                value: 0.0,
                n_clicks: 0,
                prop_clicks: 0.0,
                click_rate: 0.0,
                mean_length: 0.0,
            },
            click_matrix: Vec::new(),
        };
    }

    let freq_khz = freq_bins_hz(n_freq, wave.sample_rate);
    let mut click_heights = Vec::new();
    let mut click_time_frames = 0u32;
    let mut click_matrix = vec![vec![false; n_time]; n_freq];

    for col in 0..n_time {
        let column: Vec<f64> = (0..n_freq).map(|r| matrix[r][col]).collect();
        let diffs: Vec<f64> = column.windows(2).map(|w| w[1] - w[0]).collect();
        if diffs.iter().all(|d| d.is_nan()) {
            continue;
        }

        let is_small: Vec<bool> = diffs
            .iter()
            .map(|&d| if d.is_nan() { false } else { d.abs() < params.difference })
            .collect();

        let mut contiguous = vec![false; is_small.len() + 1];
        let mut gap_counter = 0u32;
        for (j, &small) in is_small.iter().enumerate() {
            if small {
                contiguous[j] = true;
                gap_counter = 0;
            } else if gap_counter < params.gap_allowance {
                gap_counter += 1;
                contiguous[j] = true;
            } else {
                gap_counter = 0;
            }
        }

        // RLE on contiguous blocks
        let mut pos = 0usize;
        let mut k = 0usize;
        while k < contiguous.len() {
            let val = contiguous[k];
            let mut len = 1usize;
            while k + len < contiguous.len() && contiguous[k + len] == val {
                len += 1;
            }
            if val && len > params.click_length as usize {
                click_time_frames += 1;
                click_heights.push(len as f64);
                for row in pos..(pos + len).min(n_freq) {
                    if row < n_freq {
                        click_matrix[row][col] = true;
                    }
                }
                let _ = &freq_khz; // centroids omitted for summary value
            }
            pos += len;
            k += len;
        }
    }

    let click_sum: f64 = click_heights.iter().sum();
    let total_cells = (n_freq * n_time) as f64;
    let duration = wave.duration();

    BbaiDetail {
        values: BbaiValues {
            value: ((click_sum / total_cells) * 100.0 * 1000.0).round() / 1000.0,
            n_clicks: click_heights.len() as u32,
            prop_clicks: ((click_time_frames as f64 / n_time as f64) * 1000.0).round() / 1000.0,
            click_rate: ((click_time_frames as f64 / duration) * 1000.0).round() / 1000.0,
            mean_length: if click_heights.is_empty() {
                0.0
            } else {
                (click_heights.iter().sum::<f64>() / click_heights.len() as f64 * 10.0).round() / 10.0
            },
        },
        click_matrix,
    }
}
