use crate::dsp::gini_coefficient;
use crate::indices::adi::{adi_band_proportions, band_proportions_within_band};
use crate::types::IndexParams;

pub fn aei_band_proportions(spec: &[Vec<f64>], params: &IndexParams, nyquist: f64) -> Vec<f64> {
    match params.prop_den {
        1 => band_proportions_within_band(spec, params, nyquist),
        _ => adi_band_proportions(spec, params, nyquist),
    }
}

pub fn aei_from_db_spec(spec: &[Vec<f64>], params: &IndexParams, nyquist: f64) -> f64 {
    let props = aei_band_proportions(spec, params, nyquist);
    let props: Vec<f64> = props.into_iter().map(|p| p + 0.000_001).collect();
    gini_coefficient(props)
}
