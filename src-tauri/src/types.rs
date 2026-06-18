use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BandRange {
    pub min_hz: f64,
    pub max_hz: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexParams {
    pub freq_res: f64,
    pub win_fun: String,
    pub min_freq: f64,
    pub max_freq: Option<f64>,
    pub cutoff: f64,
    pub n_bands: u32,
    /// Shared Hz bands for ADI, AEI, and FADI.
    pub div_band_ranges: Vec<BandRange>,
    pub w_len: u32,
    pub rm_offset: bool,
    pub noise_red: u8,
    pub norm_spec: bool,
    pub prop_den: u8,
    pub db_fs: bool,
    pub anthro_min: f64,
    pub anthro_max: f64,
    pub bio_min: f64,
    pub bio_max: f64,
    pub j: Option<f64>,
    /// ACI frequency range (Hz).
    pub aci_min_freq: f64,
    pub aci_max_freq: Option<f64>,
    /// BI frequency range (Hz).
    pub bi_min_freq: f64,
    pub bi_max_freq: f64,
    // NBAI / BBAI / TAI
    pub hpf: f64,
    pub activity_cutoff: f64,
    pub n_windows: u32,
    pub click_length: u32,
    pub difference: f64,
    pub gap_allowance: u32,
    // FADI
    pub nem: u8,
    pub fadi_min_freq: f64,
    pub fadi_max_freq: f64,
    pub threshold_fixed: f64,
    pub freq_step: f64,
    pub gamma: f64,
    // FCI frequency bands (Hz)
    pub lf_min: f64,
    pub lf_max: f64,
    pub mf_min: f64,
    pub mf_max: f64,
    pub hf_min: f64,
    pub hf_max: f64,
    pub uf_min: f64,
    pub uf_max: f64,
    /// Stereo handling: "each" (per channel), "left", "right", or "mix" (average L+R).
    pub channel_mode: String,
}

impl Default for IndexParams {
    fn default() -> Self {
        Self {
            freq_res: 50.0,
            win_fun: "hanning".into(),
            min_freq: 200.0,
            max_freq: Some(10_000.0),
            cutoff: -75.0,
            n_bands: 10,
            div_band_ranges: crate::indices::standard_div_band_ranges(10, 200.0),
            w_len: 512,
            rm_offset: true,
            noise_red: 0,
            norm_spec: false,
            prop_den: 2,
            db_fs: true,
            anthro_min: 1000.0,
            anthro_max: 2000.0,
            bio_min: 2000.0,
            bio_max: 11_000.0,
            j: None,
            aci_min_freq: 0.0,
            aci_max_freq: None,
            bi_min_freq: 2000.0,
            bi_max_freq: 8000.0,
            hpf: 250.0,
            activity_cutoff: 10.0,
            n_windows: 120,
            click_length: 10,
            difference: 10.0,
            gap_allowance: 2,
            nem: 2,
            fadi_min_freq: 200.0,
            fadi_max_freq: 10_000.0,
            threshold_fixed: -50.0,
            freq_step: 1000.0,
            gamma: 13.0,
            lf_min: 200.0,
            lf_max: 1500.0,
            mf_min: 1500.0,
            mf_max: 8000.0,
            hf_min: 8000.0,
            hf_max: 18_000.0,
            uf_min: 18_000.0,
            uf_max: 24_000.0,
            channel_mode: "mix".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeRequest {
    pub files: Vec<String>,
    pub indices: Vec<String>,
    pub params: IndexParams,
    pub num_threads: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResult {
    pub file_name: String,
    pub index: String,
    pub value: Option<f64>,
    pub value_l: Option<f64>,
    pub value_r: Option<f64>,
    pub value_avg: Option<f64>,
    pub channels: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramVizRequest {
    pub file_path: String,
    pub params: IndexParams,
    pub include_adi: bool,
    pub include_aei: bool,
    pub include_fci: bool,
    pub include_bbai: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BandViz {
    pub label: String,
    pub min_hz: f64,
    pub max_hz: f64,
    pub proportion: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FciBandViz {
    pub label: String,
    pub min_hz: f64,
    pub max_hz: f64,
    pub cover: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramViz {
    pub file_name: String,
    pub file_path: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub cutoff: f64,
    pub frequencies_hz: Vec<f64>,
    pub times_sec: Vec<f64>,
    pub db_matrix: Vec<Vec<f64>>,
    pub binary_matrix: Vec<Vec<u8>>,
    pub adi_value: Option<f64>,
    pub aei_value: Option<f64>,
    pub adi_bands: Option<Vec<BandViz>>,
    pub aei_bands: Option<Vec<BandViz>>,
    pub fci_bands: Option<Vec<FciBandViz>>,
    pub bbai_value: Option<f64>,
    pub bbai_click_matrix: Option<Vec<Vec<u8>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgress {
    pub completed: usize,
    pub total: usize,
    pub current_file: String,
}
