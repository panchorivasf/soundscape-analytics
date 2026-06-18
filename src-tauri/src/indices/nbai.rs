use crate::audio::Wave;
use crate::dsp::binary::spectrogram_binary;
use crate::dsp::filter::highpass;
use crate::types::IndexParams;

pub struct NbaiValues {
    pub value: f64,
    pub w_value: f64,
    pub nab: u32,
    pub pab: f64,
    pub ent: f64,
}

pub fn nbai_channel(samples: &[f64], wave: &Wave, params: &IndexParams) -> NbaiValues {
    let mut s = samples.to_vec();
    if params.hpf > 0.0 {
        s = highpass(&s, wave.sample_rate, params.hpf);
    }

    let binary = spectrogram_binary(&s, wave.sample_rate, wave, params.freq_res, params.cutoff);
    let n_rows = binary.len();
    if n_rows == 0 {
        return NbaiValues {
            value: 0.0,
            w_value: 0.0,
            nab: 0,
            pab: 0.0,
            ent: 0.0,
        };
    }

    let activity_percent: Vec<f64> = binary
        .iter()
        .map(|row| row.iter().filter(|&&b| b).count() as f64 / row.len() as f64 * 100.0)
        .collect();

    let cutoff = params.activity_cutoff;
    let nab = activity_percent.iter().filter(|&&p| p >= cutoff).count() as u32;
    let pab = (nab as f64 / n_rows as f64) * 100.0;

    // Shannon entropy of 20 activity classes (5% bins)
    let mut class_counts = [0u32; 20];
    for &p in &activity_percent {
        let mut idx = (p / 5.0).floor() as usize;
        if idx >= 20 {
            idx = 19;
        }
        class_counts[idx] += 1;
    }
    let total = n_rows as f64;
    let shannon: f64 = class_counts
        .iter()
        .map(|&c| {
            let prop = c as f64 / total;
            if prop > 0.0 {
                -prop * (prop + 0.000_001).ln()
            } else {
                0.0
            }
        })
        .sum();

    let value = (activity_percent.iter().sum::<f64>() / n_rows as f64 * 100.0).round() / 100.0;
    let value = (value * 100.0).round() / 100.0;
    let w_value = ((value * (shannon + 1.0)) * 100.0).round() / 100.0;

    NbaiValues {
        value,
        w_value,
        nab,
        pab: (pab * 100.0).round() / 100.0,
        ent: (shannon * 100.0).round() / 100.0,
    }
}
