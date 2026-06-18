use crate::audio::list_wav_files;
use crate::batch::process_files;
use crate::birdnet_analyzer::{
    self, BirdnetAnalyzeRequest, BirdnetAnalyzeResult, BirdnetDetectResult,
    BirdnetInstallRequest, BirdnetInstallResult,
};
use crate::falsecolor::{
    self, ApDetectResult, ApInstallResult, FcsComputeRequest, FcsComputeResult,
};
use crate::fcs_naming::{probe_naming, suggest_config, FcsNamingConfig, FcsNamingProbe};
use crate::fcs_pipeline::{
    self, count_fcs_segments as count_segments, FcsPostprocessRequest, FcsPostprocessResult,
};
use crate::fcs_postprocess::list_fcs_segment_names;
use crate::types::{ComputeRequest, IndexResult, SpectrogramViz, SpectrogramVizRequest};
use crate::viz::compute_spectrogram_viz;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub fn compute_indices(request: ComputeRequest) -> Result<Vec<IndexResult>, String> {
    if request.files.is_empty() {
        return Err("no files selected".into());
    }
    if request.indices.is_empty() {
        return Err("no indices selected".into());
    }
    Ok(process_files(&request))
}

#[tauri::command]
pub fn list_wav_in_folder(folder: String) -> Result<Vec<String>, String> {
    list_wav_files(Path::new(&folder)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn available_indices() -> Vec<&'static str> {
    vec![
        "aci", "adi", "aei", "bi", "ndsi", "fadi", "fci", "nbai", "bbai", "tai",
    ]
}

#[tauri::command]
pub fn default_params() -> crate::types::IndexParams {
    crate::types::IndexParams::default()
}

#[tauri::command]
pub fn export_csv(results: Vec<IndexResult>, path: String) -> Result<(), String> {
    let mut wtr = csv::Writer::from_path(&path).map_err(|e| e.to_string())?;
    wtr.write_record([
        "file_name",
        "index",
        "value",
        "value_l",
        "value_r",
        "value_avg",
        "channels",
        "duration",
        "sample_rate",
        "error",
    ])
    .map_err(|e| e.to_string())?;

    for r in results {
        wtr.write_record([
            &r.file_name,
            &r.index,
            &opt_f64(r.value),
            &opt_f64(r.value_l),
            &opt_f64(r.value_r),
            &opt_f64(r.value_avg),
            &r.channels,
            &r.duration.to_string(),
            &r.sample_rate.to_string(),
            &r.error.unwrap_or_default(),
        ])
        .map_err(|e| e.to_string())?;
    }
    wtr.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_table(
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    path: String,
    format: String,
) -> Result<(), String> {
    crate::table_export::export_table(&path, &format, &columns, &rows)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

fn opt_f64(v: Option<f64>) -> String {
    v.map(|x| format!("{x:.6}"))
        .unwrap_or_default()
}

#[tauri::command]
pub fn spectrogram_viz(request: SpectrogramVizRequest) -> Result<SpectrogramViz, String> {
    compute_spectrogram_viz(&request)
}

#[tauri::command]
pub fn list_birdnet_in_folder(folder: String, recursive: bool) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    collect_birdnet_files(&PathBuf::from(folder), recursive, &mut files)
        .map_err(|e| e.to_string())?;
    files.sort();
    Ok(files)
}

fn collect_birdnet_files(
    dir: &Path,
    recursive: bool,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("csv") || ext.eq_ignore_ascii_case("txt") {
                    out.push(path.to_string_lossy().into_owned());
                }
            }
        } else if recursive && path.is_dir() {
            collect_birdnet_files(&path, true, out)?;
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct TextFileContent {
    path: String,
    content: String,
}

#[tauri::command]
pub fn read_text_files(paths: Vec<String>) -> Result<Vec<TextFileContent>, String> {
    paths
        .into_iter()
        .map(|path| {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            Ok(TextFileContent { path, content })
        })
        .collect()
}

#[tauri::command]
pub fn detect_birdnet_analyzer(python: Option<String>) -> BirdnetDetectResult {
    birdnet_analyzer::detect_birdnet(python)
}

#[tauri::command]
pub async fn run_birdnet_analyze(
    app: AppHandle,
    request: BirdnetAnalyzeRequest,
) -> Result<BirdnetAnalyzeResult, String> {
    tauri::async_runtime::spawn_blocking(move || birdnet_analyzer::run_birdnet_analyze(app, request))
        .await
        .map_err(|e| format!("BirdNET task failed: {e}"))?
}

#[tauri::command]
pub fn cancel_birdnet_analyze() -> Result<(), String> {
    birdnet_analyzer::cancel_birdnet_analyze()
}

#[tauri::command]
pub fn birdnet_analyze_running() -> bool {
    birdnet_analyzer::birdnet_analyze_running()
}

#[tauri::command]
pub async fn install_birdnet_analyzer(
    app: AppHandle,
    request: BirdnetInstallRequest,
) -> Result<BirdnetInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        birdnet_analyzer::install_birdnet_analyzer(app, request.python)
    })
    .await
    .map_err(|e| format!("BirdNET install task failed: {e}"))?
}

#[tauri::command]
pub fn detect_analysis_programs(ap_root: Option<String>) -> ApDetectResult {
    falsecolor::detect_ap(ap_root)
}

#[tauri::command]
pub async fn install_analysis_programs(app: AppHandle) -> Result<ApInstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || falsecolor::install_analysis_programs(app))
        .await
        .map_err(|e| format!("AP install task failed: {e}"))?
}

#[tauri::command]
pub async fn run_fcs_compute(
    app: AppHandle,
    request: FcsComputeRequest,
) -> Result<FcsComputeResult, String> {
    tauri::async_runtime::spawn_blocking(move || falsecolor::run_fcs_compute(app, request))
        .await
        .map_err(|e| format!("FCS task failed: {e}"))?
}

#[tauri::command]
pub fn cancel_fcs_compute() -> Result<(), String> {
    falsecolor::cancel_fcs()
}

#[tauri::command]
pub fn fcs_compute_running() -> bool {
    falsecolor::fcs_running()
}

#[tauri::command]
pub fn count_fcs_segments(segments_directory: String) -> Result<u32, String> {
    count_segments(Path::new(&segments_directory))
}

#[tauri::command]
pub fn probe_fcs_naming(
    segments_directory: String,
    config: Option<FcsNamingConfig>,
) -> Result<FcsNamingProbe, String> {
    let dir = Path::new(&segments_directory);
    let names = list_fcs_segment_names(dir, true)?;
    if names.is_empty() {
        return Err("No segment PNGs found in this folder.".into());
    }
    let cfg = config.unwrap_or_else(|| suggest_config(&names[0]));
    Ok(probe_naming(&names, &cfg))
}

#[tauri::command]
pub async fn run_fcs_postprocess(
    request: FcsPostprocessRequest,
) -> Result<FcsPostprocessResult, String> {
    tauri::async_runtime::spawn_blocking(move || fcs_pipeline::run_fcs_postprocess(request))
        .await
        .map_err(|e| format!("FCS post-process task failed: {e}"))?
}
