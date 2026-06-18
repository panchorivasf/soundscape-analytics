mod aci;
mod adi;
mod aei;
mod bands;
mod bbai;
mod bi;
mod fadi;
mod fci;
mod nbai;
mod ndsi;
mod tai;

pub use aci::compute_aci_from_prepared;
pub use adi::{adi_band_proportions, adi_band_ranges_hz, adi_from_db_spec};
pub use aei::{aei_band_proportions, aei_from_db_spec};
pub use bands::standard_div_band_ranges;
pub use bbai::{bbai_channel, bbai_channel_detail, BbaiDetail};
pub use bi::compute_bi_from_prepared;
pub use fadi::fadi_channel;
pub use fci::compute_fci;
pub use nbai::nbai_channel;
pub use ndsi::compute_ndsi_from_prepared;
pub use tai::tai_channel;

use crate::audio::{resolve_channel_mode, Channel, Wave};
use crate::dsp::prepare_channel;
use crate::dsp::spectrogram::{
    compute_spectrogram, to_dbfs_matrix, SpectroOptions, window_length_from_freq_res,
};
use crate::types::{IndexParams, IndexResult};

fn base_result(wave: &Wave, file_name: &str, index: &str, channels: &str) -> IndexResult {
    IndexResult {
        file_name: file_name.to_string(),
        index: index.to_string(),
        value: None,
        value_l: None,
        value_r: None,
        value_avg: None,
        channels: channels.to_string(),
        duration: wave.duration(),
        sample_rate: wave.sample_rate,
        error: None,
    }
}

fn stereo_values(vl: f64, vr: f64) -> (Option<f64>, Option<f64>, Option<f64>) {
    (Some(vl), Some(vr), Some((vl + vr) / 2.0))
}

/// Compute all requested indices for one file, sharing spectrograms where possible.
pub fn compute_all_for_wave(
    wave: &Wave,
    file_name: &str,
    indices: &[String],
    params: &IndexParams,
) -> Vec<IndexResult> {
    let (wave, channels_label) = resolve_channel_mode(wave, &params.channel_mode);
    let wave = wave.as_ref();

    let needs_aci = indices.iter().any(|i| i.eq_ignore_ascii_case("aci"));
    let needs_db_spec = indices
        .iter()
        .any(|i| matches!(i.to_lowercase().as_str(), "adi" | "aei"));

    let rm = params.rm_offset;
    let left_samples = prepare_channel(wave, Channel::Left, rm);
    let right_samples = wave
        .is_stereo()
        .then(|| prepare_channel(wave, Channel::Right, rm));

    let wl_freq = window_length_from_freq_res(wave.sample_rate, params.freq_res);
    let db_opts = SpectroOptions {
        wl: wl_freq,
        win_fun: params.win_fun.clone(),
        normalized: params.norm_spec,
        amplitude_correction: !params.norm_spec,
        noise_red: params.noise_red,
        ..Default::default()
    };

    let left_db = needs_db_spec.then(|| {
        let spec = compute_spectrogram(&left_samples, wave.sample_rate, &db_opts);
        if params.norm_spec {
            spec.as_matrix()
        } else if params.db_fs {
            to_dbfs_matrix(&spec, wave.amp_max())
        } else {
            let mut m = spec.as_matrix();
            crate::dsp::to_power_db(&mut m);
            m
        }
    });

    let right_db = needs_db_spec
        .then(|| right_samples.as_ref())
        .flatten()
        .map(|samples| {
            let spec = compute_spectrogram(samples, wave.sample_rate, &db_opts);
            if params.norm_spec {
                spec.as_matrix()
            } else if params.db_fs {
                to_dbfs_matrix(&spec, wave.amp_max())
            } else {
                let mut m = spec.as_matrix();
                crate::dsp::to_power_db(&mut m);
                m
            }
        });

    let aci_opts = SpectroOptions {
        wl: wl_freq,
        win_fun: params.win_fun.clone(),
        normalized: true,
        amplitude_correction: false,
        noise_red: params.noise_red,
        ..Default::default()
    };

    let left_aci = needs_aci.then(|| compute_spectrogram(&left_samples, wave.sample_rate, &aci_opts));
    let right_aci = needs_aci
        .then(|| right_samples.as_ref())
        .flatten()
        .map(|s| compute_spectrogram(s, wave.sample_rate, &aci_opts));

    indices
        .iter()
        .flat_map(|index_name| {
            compute_one_index(
                wave,
                file_name,
                index_name,
                params,
                channels_label,
                &left_samples,
                right_samples.as_deref(),
                left_db.as_ref(),
                right_db.as_ref(),
                left_aci.as_ref(),
                right_aci.as_ref(),
            )
        })
        .collect()
}

fn compute_one_index(
    wave: &Wave,
    file_name: &str,
    index_name: &str,
    params: &IndexParams,
    channels_label: &str,
    left: &[f64],
    right: Option<&[f64]>,
    left_db: Option<&Vec<Vec<f64>>>,
    right_db: Option<&Vec<Vec<f64>>>,
    left_aci: Option<&crate::dsp::spectrogram::Spectrogram>,
    right_aci: Option<&crate::dsp::spectrogram::Spectrogram>,
) -> Vec<IndexResult> {
    let name = index_name.to_lowercase();
    match name.as_str() {
        "aci" => vec![compute_aci_from_prepared(
            wave,
            base_result(wave, file_name, "aci", channels_label),
            params,
            left_aci,
            right_aci,
        )],
        "adi" => {
            let mut base = base_result(wave, file_name, "adi", channels_label);
            let nyquist = wave.nyquist();
            if wave.is_stereo() {
                let vl = left_db
                    .map(|s| adi_from_db_spec(s, params, nyquist))
                    .unwrap_or(0.0);
                let vr = right_db
                    .map(|s| adi_from_db_spec(s, params, nyquist))
                    .unwrap_or(0.0);
                base.value_l = Some(vl);
                base.value_r = Some(vr);
                base.value_avg = Some((vl + vr) / 2.0);
            } else {
                base.value = left_db.map(|s| adi_from_db_spec(s, params, nyquist));
            }
            vec![base]
        }
        "aei" => {
            let mut base = base_result(wave, file_name, "aei", channels_label);
            let nyquist = wave.nyquist();
            if wave.is_stereo() {
                let vl = left_db
                    .map(|s| aei_from_db_spec(s, params, nyquist))
                    .unwrap_or(0.0);
                let vr = right_db
                    .map(|s| aei_from_db_spec(s, params, nyquist))
                    .unwrap_or(0.0);
                base.value_l = Some(vl);
                base.value_r = Some(vr);
                base.value_avg = Some((vl + vr) / 2.0);
            } else {
                base.value = left_db.map(|s| aei_from_db_spec(s, params, nyquist));
            }
            vec![base]
        }
        "bi" => vec![compute_bi_from_prepared(
            wave,
            base_result(wave, file_name, "bi", channels_label),
            params,
            left,
            right,
        )],
        "ndsi" => vec![compute_ndsi_from_prepared(
            wave,
            base_result(wave, file_name, "ndsi", channels_label),
            params,
            left,
            right,
        )],
        "fadi" => {
            let mut base = base_result(wave, file_name, "fadi", channels_label);
            if wave.is_stereo() {
                match (fadi_channel(left, wave, params), right.map(|r| fadi_channel(r, wave, params))) {
                    (Ok(vl), Some(Ok(vr))) => {
                        let (l, r, a) = stereo_values(vl, vr);
                        base.value_l = l;
                        base.value_r = r;
                        base.value_avg = a;
                    }
                    (Err(e), _) | (_, Some(Err(e))) => base.error = Some(e),
                    (Ok(vl), None) => base.value_l = Some(vl),
                }
            } else {
                match fadi_channel(left, wave, params) {
                    Ok(v) => base.value = Some(v),
                    Err(e) => base.error = Some(e),
                }
            }
            vec![base]
        }
        "fci" => {
            let (l, r) = compute_fci(wave, left, right, params);
            let l = l.unwrap();
            let bands = [("lfc", l.lfc), ("mfc", l.mfc), ("hfc", l.hfc), ("ufc", l.ufc)];
            bands
                .into_iter()
                .map(|(band, vl)| {
                    let mut row = base_result(wave, file_name, band, channels_label);
                    if let Some(ref rv) = r {
                        let vr = match band {
                            "lfc" => rv.lfc,
                            "mfc" => rv.mfc,
                            "hfc" => rv.hfc,
                            _ => rv.ufc,
                        };
                        let (l, r, a) = stereo_values(vl, vr);
                        row.value_l = l;
                        row.value_r = r;
                        row.value_avg = a;
                    } else {
                        row.value = Some(vl);
                    }
                    row
                })
                .collect()
        }
        "nbai" => {
            let mut base = base_result(wave, file_name, "nbai", channels_label);
            let vl = nbai_channel(left, wave, params);
            if let Some(r) = right {
                let vr = nbai_channel(r, wave, params);
                base.value_l = Some(vl.value);
                base.value_r = Some(vr.value);
                base.value_avg = Some((vl.value + vr.value) / 2.0);
            } else {
                base.value = Some(vl.value);
            }
            vec![base]
        }
        "bbai" => {
            let mut base = base_result(wave, file_name, "bbai", channels_label);
            let vl = bbai_channel(left, wave, params);
            if let Some(r) = right {
                let vr = bbai_channel(r, wave, params);
                base.value_l = Some(vl.value);
                base.value_r = Some(vr.value);
                base.value_avg = Some((vl.value + vr.value) / 2.0);
            } else {
                base.value = Some(vl.value);
            }
            vec![base]
        }
        "tai" => {
            let mut base = base_result(wave, file_name, "tai", channels_label);
            let vl = tai_channel(left, wave, params);
            if let Some(r) = right {
                let vr = tai_channel(r, wave, params);
                base.value_l = Some(vl.value);
                base.value_r = Some(vr.value);
                base.value_avg = Some((vl.value + vr.value) / 2.0);
            } else {
                base.value = Some(vl.value);
            }
            vec![base]
        }
        other => vec![IndexResult {
            error: Some(format!("unknown index: {other}")),
            ..base_result(wave, file_name, other, channels_label)
        }],
    }
}
