pub fn window(name: &str, len: usize) -> Vec<f64> {
    match name.to_lowercase().as_str() {
        "bartlett" => bartlett(len),
        "blackman" => blackman(len),
        "flattop" => flattop(len),
        "hamming" => hamming(len),
        "rectangle" | "rectangular" => vec![1.0; len],
        _ => hanning(len),
    }
}

pub fn hanning(len: usize) -> Vec<f64> {
    if len <= 1 {
        return vec![1.0; len.max(1)];
    }
    (0..len)
        .map(|i| 0.5 * (1.0 - (2.0 * std::f64::consts::PI * i as f64 / (len - 1) as f64).cos()))
        .collect()
}

pub fn hamming(len: usize) -> Vec<f64> {
    if len <= 1 {
        return vec![1.0; len.max(1)];
    }
    (0..len)
        .map(|i| 0.54 - 0.46 * (2.0 * std::f64::consts::PI * i as f64 / (len - 1) as f64).cos())
        .collect()
}

pub fn blackman(len: usize) -> Vec<f64> {
    if len <= 1 {
        return vec![1.0; len.max(1)];
    }
    (0..len)
        .map(|i| {
            let x = 2.0 * std::f64::consts::PI * i as f64 / (len - 1) as f64;
            0.42 - 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
        })
        .collect()
}

pub fn bartlett(len: usize) -> Vec<f64> {
    if len <= 1 {
        return vec![1.0; len.max(1)];
    }
    let mid = (len - 1) as f64 / 2.0;
    (0..len)
        .map(|i| 1.0 - ((i as f64 - mid).abs() / mid))
        .collect()
}

pub fn flattop(len: usize) -> Vec<f64> {
    if len <= 1 {
        return vec![1.0; len.max(1)];
    }
    (0..len)
        .map(|i| {
            let x = 2.0 * std::f64::consts::PI * i as f64 / (len - 1) as f64;
            0.21557895
                - 0.41663158 * x.cos()
                + 0.277263158 * (2.0 * x).cos()
                - 0.083578947 * (3.0 * x).cos()
                + 0.006947368 * (4.0 * x).cos()
        })
        .collect()
}
