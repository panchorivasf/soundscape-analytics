/// One-pole high-pass filter (matches seewave::fir bandpass intent for index preprocessing).
pub fn highpass(samples: &[f64], sample_rate: u32, cutoff_hz: f64) -> Vec<f64> {
    if cutoff_hz <= 0.0 || samples.is_empty() {
        return samples.to_vec();
    }
    let rc = 1.0 / (2.0 * std::f64::consts::PI * cutoff_hz);
    let dt = 1.0 / sample_rate as f64;
    let alpha = rc / (rc + dt);

    let mut out = Vec::with_capacity(samples.len());
    out.push(samples[0]);
    for i in 1..samples.len() {
        out.push(alpha * (out[i - 1] + samples[i] - samples[i - 1]));
    }
    out
}
