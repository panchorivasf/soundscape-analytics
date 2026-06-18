use crate::dsp::spectrogram::pwelch_segment;

/// Average Welch PSD across 1-second segments (NDSI pipeline).
pub fn mean_spectrum(samples: &[f64], sample_rate: u32, w_len: usize, duration: f64) -> Vec<f64> {
    let n_seconds = duration.floor() as usize;
    if n_seconds == 0 {
        return pwelch_segment(samples, sample_rate, w_len);
    }

    let mut accum = vec![0.0; w_len / 2];
    for sec in 0..n_seconds {
        let start = sec * sample_rate as usize;
        let end = start + sample_rate as usize;
        if end > samples.len() {
            break;
        }
        let segment = &samples[start..end];
        let psd = pwelch_segment(segment, sample_rate, w_len);
        for (a, p) in accum.iter_mut().zip(psd.iter()) {
            *a += p;
        }
    }

    let n = n_seconds.max(1) as f64;
    accum.iter_mut().for_each(|v| *v /= n);
    accum
}
