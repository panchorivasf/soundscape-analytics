use crate::audio::wav_duration_secs;
use crate::fcs_manifest::{FcsManifest, FcsManifestEntry};
use crate::fcs_naming::{parse_datetime_from_name, suggest_config};
use crate::fcs_postprocess::list_fcs_segment_paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

const DEFAULT_AP_ROOT: &str = r"C:\AP";
const AP_EXE: &str = "AnalysisPrograms.exe";
const INSTALL_HINT: &str =
    "Install AnalysisPrograms.exe to C:\\AP using the Install button (requires PowerShell 7+, admin, internet). See https://ap.qut.ecoacoustics.info/basics/installing";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApDetectResult {
    pub available: bool,
    pub ap_root: String,
    pub exe_path: String,
    pub version_hint: String,
    pub install_hint: String,
    pub can_install: bool,
    pub config_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApInstallResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsComputeRequest {
    pub audio_directory: String,
    pub output_directory: String,
    pub ap_root: Option<String>,
    pub add_hi_res: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcsComputeResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
    pub output_directory: String,
    pub segment_count: u32,
    pub files_processed: u32,
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    stream: String,
    line: String,
}

struct RunningJob {
    child: std::process::Child,
    cancel: Arc<AtomicBool>,
}

static RUNNING: Mutex<Option<RunningJob>> = Mutex::new(None);

pub fn ap_root_from_option(ap_root: Option<&str>) -> PathBuf {
    ap_root
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_AP_ROOT))
}

pub fn detect_ap(ap_root: Option<String>) -> ApDetectResult {
    let root = ap_root_from_option(ap_root.as_deref());
    let exe = root.join(AP_EXE);
    let config = root.join("ConfigFiles").join("Towsey.Acoustic.yml");
    let config_ok = config.is_file();

    if !exe.is_file() {
        return ApDetectResult {
            available: false,
            ap_root: root.to_string_lossy().into_owned(),
            exe_path: exe.to_string_lossy().into_owned(),
            version_hint: String::new(),
            install_hint: INSTALL_HINT.to_string(),
            can_install: cfg!(windows),
            config_ok: false,
        };
    }

    let version_hint = probe_ap_version(&exe).unwrap_or_else(|| "AnalysisPrograms.exe found".to_string());

    ApDetectResult {
        available: config_ok,
        ap_root: root.to_string_lossy().into_owned(),
        exe_path: exe.to_string_lossy().into_owned(),
        version_hint,
        install_hint: if config_ok {
            String::new()
        } else {
            format!(
                "AnalysisPrograms.exe found but ConfigFiles/Towsey.Acoustic.yml is missing under {}. Reinstall AP.",
                root.display()
            )
        },
        can_install: cfg!(windows),
        config_ok,
    }
}

fn probe_ap_version(exe: &Path) -> Option<String> {
    let out = Command::new(exe)
        .arg("--version")
        .env("AP", exe.parent().unwrap_or(Path::new(DEFAULT_AP_ROOT)))
        .output()
        .ok()?;
    let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&out.stderr).trim().to_string();
    }
    if text.is_empty() {
        None
    } else {
        Some(text.lines().next().unwrap_or(&text).to_string())
    }
}

pub fn install_analysis_programs(app: AppHandle) -> Result<ApInstallResult, String> {
    if !cfg!(windows) {
        return Ok(ApInstallResult {
            success: false,
            exit_code: None,
            message: "Automatic AP install is supported on Windows only.".to_string(),
            cancelled: false,
        });
    }

    {
        let guard = RUNNING.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Another FCS job is running. Cancel it before installing.".into());
        }
    }

    emit_log(&app, "stdout", "=== AnalysisPrograms.exe installation ===");
    emit_log(
        &app,
        "stdout",
        "Running QUT Ecoacoustics installer (may prompt for administrator approval)…",
    );
    emit_log(
        &app,
        "stdout",
        "Script: https://git.io/JtOo3 → download_ap.ps1",
    );

    let script = r#"& { $ErrorActionPreference = 'Stop'; iex (irm 'https://git.io/JtOo3') }"#;
    let shells: &[(&str, &[&str])] = &[
        ("pwsh", &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]),
        (
            "powershell",
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        ),
    ];

    let mut last_err = String::new();
    for (shell, args) in shells {
        emit_log(&app, "stdout", &format!("Trying {shell}…"));
        match Command::new(shell)
            .args(*args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(mut child) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let app_out = app.clone();
                if let Some(out) = stdout {
                    thread::spawn(move || stream_pipe(out, "stdout", app_out));
                }
                let app_err = app.clone();
                if let Some(err) = stderr {
                    thread::spawn(move || stream_pipe(err, "stderr", app_err));
                }
                let status = child.wait().map_err(|e| e.to_string())?;
                let code = status.code();
                let ok = status.success();
                let msg = if ok {
                    format!(
                        "AnalysisPrograms.exe installed. Expected location: {DEFAULT_AP_ROOT}\\{AP_EXE}"
                    )
                } else {
                    format!(
                        "Installer exited with code {:?}. If install failed, run PowerShell as Administrator and use the command from https://ap.qut.ecoacoustics.info/basics/installing",
                        code
                    )
                };
                emit_log(&app, "stdout", &msg);
                return Ok(ApInstallResult {
                    success: ok,
                    exit_code: code,
                    message: msg,
                    cancelled: false,
                });
            }
            Err(e) => {
                last_err = format!("{shell}: {e}");
            }
        }
    }

    Ok(ApInstallResult {
        success: false,
        exit_code: None,
        message: format!(
            "Could not run installer ({last_err}). Install PowerShell 7+ and run as Administrator. Manual: pwsh -nop -ex B -c '$function:i=irm \"https://git.io/JtOo3\";i'"
        ),
        cancelled: false,
    })
}

pub fn fcs_running() -> bool {
    RUNNING.lock().ok().map(|g| g.is_some()).unwrap_or(false)
}

pub fn cancel_fcs() -> Result<(), String> {
    let mut guard = RUNNING.lock().map_err(|e| e.to_string())?;
    if let Some(job) = guard.as_mut() {
        job.cancel.store(true, Ordering::SeqCst);
        let _ = job.child.kill();
        Ok(())
    } else {
        Err("No FCS job is running".into())
    }
}

pub fn run_fcs_compute(app: AppHandle, request: FcsComputeRequest) -> Result<FcsComputeResult, String> {
    if request.audio_directory.trim().is_empty() {
        return Err("audio folder is required".into());
    }
    if request.output_directory.trim().is_empty() {
        return Err("output folder is required".into());
    }

    let detect = detect_ap(request.ap_root.clone());
    if !detect.available {
        return Err(if detect.install_hint.is_empty() {
            INSTALL_HINT.to_string()
        } else {
            detect.install_hint
        });
    }

    {
        let guard = RUNNING.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("FCS pipeline is already running".into());
        }
    }

    let ap_root = ap_root_from_option(request.ap_root.as_deref());
    let exe = ap_root.join(AP_EXE);
    let audio_dir = PathBuf::from(&request.audio_directory);
    let output_dir = PathBuf::from(&request.output_directory);
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let audio_files = list_audio_files(&audio_dir)?;
    if audio_files.is_empty() {
        return Err("No audio files found (supported: wav, flac, mp3, wma, ogg)".into());
    }

    emit_log(
        &app,
        "stdout",
        &format!("Found {} audio file(s). Starting fcs_compute…", audio_files.len()),
    );

    let cancel = Arc::new(AtomicBool::new(false));
    let mut files_processed = 0u32;
    let mut had_error = false;

    let naming = audio_files
        .first()
        .and_then(|p| p.file_stem())
        .and_then(|s| s.to_str())
        .map(|stem| suggest_config(&format!("{stem}__ACI-ENT-EVN.png")))
        .unwrap_or_default();
    let mut manifest = FcsManifest::new(&audio_dir, naming);

    for (i, audio) in audio_files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_result(&output_dir, files_processed));
        }

        let file_name = audio
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("audio");
        emit_log(
            &app,
            "stdout",
            &format!("\nProcessing {}/{} — {}", i + 1, audio_files.len(), audio.display()),
        );

        let indices_dir = output_dir.join("Indices").join(file_name);
        fs::create_dir_all(&indices_dir).map_err(|e| e.to_string())?;

        match run_audio2csv(&app, &exe, &ap_root, audio, &indices_dir, &cancel) {
            Ok(()) => {
                let stem = audio
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(file_name);
                let dest_name = format!("{stem}__ACI-ENT-EVN.png");
                let copied = copy_fcs_png_as(&indices_dir, &output_dir, &dest_name)?;
                if copied {
                    emit_log(
                        &app,
                        "stdout",
                        &format!("Saved segment FCS as {dest_name}."),
                    );
                } else {
                    emit_log(
                        &app,
                        "stdout",
                        "Warning: AP did not produce an ACI-ENT-EVN PNG for this file.",
                    );
                }
                if copied {
                    let duration_secs = wav_duration_secs(audio).unwrap_or(0.0);
                    let start_iso = parse_datetime_from_name(&dest_name, &manifest.naming)
                        .ok()
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string());
                    manifest.segments.push(FcsManifestEntry {
                        segment_png: dest_name,
                        audio_file: audio.to_string_lossy().into_owned(),
                        duration_secs,
                        start_iso,
                    });
                }
                if request.add_hi_res {
                    if cancel.load(Ordering::SeqCst) {
                        return Ok(cancelled_result(&output_dir, files_processed));
                    }
                    let hi_res_dir = output_dir.join("HiRes").join(file_name);
                    if let Err(e) = run_draw_lds(
                        &app,
                        &exe,
                        &ap_root,
                        &indices_dir,
                        &hi_res_dir,
                        file_name,
                        true,
                        &cancel,
                    ) {
                        emit_log(&app, "stderr", &format!("HiRes draw: {e}"));
                    }
                }
                files_processed += 1;
            }
            Err(e) => {
                if e == "cancelled" {
                    return Ok(cancelled_result(&output_dir, files_processed));
                }
                emit_log(&app, "stderr", &format!("Error: {e}"));
                had_error = true;
            }
        }
    }

    let segment_count = list_fcs_segment_paths(&output_dir, true)?.len() as u32;
    if !manifest.segments.is_empty() {
        if let Err(e) = manifest.save(&output_dir) {
            emit_log(&app, "stderr", &format!("Could not write fcs_manifest.json: {e}"));
        } else {
            emit_log(
                &app,
                "stdout",
                &format!(
                    "Wrote fcs_manifest.json ({} segment(s) with durations).",
                    manifest.segments.len()
                ),
            );
        }
    }
    let success = !had_error && files_processed > 0;
    let message = if cancel.load(Ordering::SeqCst) {
        "Cancelled.".to_string()
    } else if success {
        format!(
            "AP compute done — {files_processed} recording(s), {segment_count} segment FCS tile(s). Run falsecoloR post-processing on this folder next."
        )
    } else {
        "Completed with errors. See log.".to_string()
    };

    emit_log(&app, "stdout", &format!("\n{message}"));

    Ok(FcsComputeResult {
        success,
        exit_code: if had_error { Some(1) } else { Some(0) },
        message,
        output_directory: output_dir.to_string_lossy().into_owned(),
        segment_count,
        files_processed,
        cancelled: cancel.load(Ordering::SeqCst),
    })
}

fn cancelled_result(output_dir: &Path, files_processed: u32) -> FcsComputeResult {
    FcsComputeResult {
        success: false,
        exit_code: None,
        message: "FCS compute cancelled.".to_string(),
        output_directory: output_dir.to_string_lossy().into_owned(),
        segment_count: 0,
        files_processed,
        cancelled: true,
    }
}

fn run_audio2csv(
    app: &AppHandle,
    exe: &Path,
    ap_root: &Path,
    audio: &Path,
    output_folder: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let config = ap_root.join("ConfigFiles").join("Towsey.Acoustic.yml");
    let mut child = Command::new(exe)
        .arg("audio2csv")
        .arg(audio)
        .arg(&config)
        .arg(output_folder)
        .arg("-l")
        .arg("3")
        .arg("--parallel")
        .arg("--when-exit-copy-config")
        .env("AP", ap_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start AP audio2csv: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = RUNNING.lock().map_err(|e| e.to_string())?;
        *guard = Some(RunningJob {
            child,
            cancel: Arc::clone(cancel),
        });
    }

    let app_out = app.clone();
    let cancel_out = Arc::clone(cancel);
    if let Some(out) = stdout {
        thread::spawn(move || stream_pipe_with_cancel(out, "stdout", app_out, cancel_out));
    }
    let app_err = app.clone();
    if let Some(err) = stderr {
        thread::spawn(move || stream_pipe(err, "stderr", app_err));
    }

    let wait_result = wait_for_job(cancel);
    match wait_result {
        JobWait::Cancelled => Err("cancelled".into()),
        JobWait::Failed(e) => Err(e),
        JobWait::Finished(status) => {
            if !status.success() {
                emit_log(
                    app,
                    "stderr",
                    &format!("audio2csv exited with code {:?}", status.code()),
                );
                return Err(format!("audio2csv failed (exit {:?})", status.code()));
            }
            Ok(())
        }
    }
}

fn run_draw_lds(
    app: &AppHandle,
    exe: &Path,
    ap_root: &Path,
    indices_dir: &Path,
    dest_dir: &Path,
    file_name: &str,
    hi_res: bool,
    cancel: &Arc<AtomicBool>,
) -> Result<Vec<PathBuf>, String> {
    let input_folder = indices_dir.join("Towsey.Acoustic");
    if !input_folder.is_dir() {
        return Err(format!(
            "Towsey.Acoustic folder missing under {} — audio2csv may have failed",
            indices_dir.display()
        ));
    }

    let draw_out = indices_dir.join(if hi_res { "DrawHiRes" } else { "DrawFCS" });
    fs::create_dir_all(&draw_out).map_err(|e| e.to_string())?;
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;

    let fcs_config = ap_root.join("ConfigFiles").join("SpectrogramFalseColourConfig.yml");
    let ip_config = if hi_res {
        ap_root.join("ConfigFiles").join("IndexPropertiesConfig.HiRes.yml")
    } else {
        ap_root.join("ConfigFiles").join("IndexPropertiesConfig.yml")
    };

    emit_log(
        app,
        "stdout",
        &format!(
            "DrawLongDurationSpectrograms{} for {file_name}…",
            if hi_res { " (HiRes)" } else { "" }
        ),
    );

    let child = Command::new(exe)
        .arg("DrawLongDurationSpectrograms")
        .arg("-i")
        .arg(&input_folder)
        .arg("-o")
        .arg(&draw_out)
        .arg("-fcs")
        .arg(&fcs_config)
        .arg("-ip")
        .arg(&ip_config)
        .env("AP", ap_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start DrawLongDurationSpectrograms: {e}"))?;

    {
        let mut guard = RUNNING.lock().map_err(|e| e.to_string())?;
        *guard = Some(RunningJob {
            child,
            cancel: Arc::clone(cancel),
        });
    }

    let wait_result = wait_for_job(cancel);
    match wait_result {
        JobWait::Cancelled => Err("cancelled".into()),
        JobWait::Failed(e) => Err(e),
        JobWait::Finished(status) => {
            if !status.success() {
                return Err(format!(
                    "DrawLongDurationSpectrograms failed (exit {:?})",
                    status.code()
                ));
            }
            if hi_res {
                let _ = copy_fcs_pngs(&draw_out, dest_dir)?;
                Ok(list_fcs_pngs_in(dest_dir)?)
            } else {
                copy_best_fcs_to_composite(&draw_out, dest_dir, file_name)
            }
        }
    }
}

/// Copy the largest ACI-ENT-EVN PNG from AP draw output into Composites under a stable name.
fn copy_best_fcs_to_composite(
    from_dir: &Path,
    composites_dir: &Path,
    file_name: &str,
) -> Result<Vec<PathBuf>, String> {
    let mut best: Option<(PathBuf, u64)> = None;
    collect_largest_fcs(from_dir, &mut best)?;
    let Some((src, _)) = best else {
        return Err("DrawLongDurationSpectrograms produced no *_ACI-ENT-EVN.png".into());
    };
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let dest = composites_dir.join(format!("{stem}.png"));
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(vec![dest])
}

fn collect_largest_fcs(dir: &Path, best: &mut Option<(PathBuf, u64)>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_largest_fcs(&path, best)?;
        } else if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains("ACI-ENT-EVN") && name.to_ascii_lowercase().ends_with(".png") {
                let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                if best.as_ref().map(|(_, s)| size > *s).unwrap_or(true) {
                    *best = Some((path, size));
                }
            }
        }
    }
    Ok(())
}

fn list_fcs_pngs_in(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    collect_fcs_paths(dir, &mut out)?;
    Ok(out)
}

fn collect_fcs_paths(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_fcs_paths(&path, out)?;
        } else {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains("ACI-ENT-EVN") && name.to_ascii_lowercase().ends_with(".png") {
                out.push(path);
            }
        }
    }
    Ok(())
}

fn copy_fcs_png_as(from_dir: &Path, to_dir: &Path, dest_name: &str) -> Result<bool, String> {
    let mut found = None;
    find_first_fcs_png(from_dir, &mut found)?;
    if let Some(src) = found {
        fs::copy(&src, to_dir.join(dest_name)).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn find_first_fcs_png(dir: &Path, out: &mut Option<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            find_first_fcs_png(&path, out)?;
            if out.is_some() {
                return Ok(());
            }
        } else if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains("_ACI-ENT-EVN") && name.to_ascii_lowercase().ends_with(".png") {
                *out = Some(path);
                return Ok(());
            }
        }
    }
    Ok(())
}

fn copy_fcs_pngs(from_dir: &Path, to_dir: &Path) -> Result<usize, String> {
    let mut n = 0usize;
    copy_fcs_pngs_recursive(from_dir, to_dir, &mut n)?;
    Ok(n)
}

fn copy_fcs_pngs_recursive(dir: &Path, to_dir: &Path, count: &mut usize) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            copy_fcs_pngs_recursive(&path, to_dir, count)?;
        } else if path.is_file() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.contains("_ACI-ENT-EVN") && name.to_lowercase().ends_with(".png") {
                let dest = to_dir.join(name);
                fs::copy(&path, &dest).map_err(|e| e.to_string())?;
                *count += 1;
            }
        }
    }
    Ok(())
}

fn list_audio_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_audio(dir, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_audio(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if is_audio_file(&path) {
                out.push(path);
            }
        } else if path.is_dir() {
            collect_audio(&path, out)?;
        }
    }
    Ok(())
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "wav" | "flac" | "mp3" | "wma" | "ogg"
            )
        })
        .unwrap_or(false)
}

enum JobWait {
    Cancelled,
    Failed(String),
    Finished(std::process::ExitStatus),
}

fn wait_for_job(cancel: &Arc<AtomicBool>) -> JobWait {
    loop {
        let status = {
            let mut guard = match RUNNING.lock() {
                Ok(g) => g,
                Err(e) => return JobWait::Failed(e.to_string()),
            };
            let Some(job) = guard.as_mut() else {
                return JobWait::Failed("Job handle lost".into());
            };
            if cancel.load(Ordering::SeqCst) {
                let _ = job.child.kill();
            }
            match job.child.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    Some(status)
                }
                Ok(None) => None,
                Err(e) => {
                    guard.take();
                    return JobWait::Failed(e.to_string());
                }
            }
        };
        if let Some(status) = status {
            if cancel.load(Ordering::SeqCst) {
                return JobWait::Cancelled;
            }
            return JobWait::Finished(status);
        }
        if cancel.load(Ordering::SeqCst) {
            let mut guard = RUNNING.lock().ok();
            if let Some(g) = guard.as_mut() {
                let _ = g.as_mut().map(|j| j.child.kill());
                g.take();
            }
            return JobWait::Cancelled;
        }
        thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn emit_log(app: &AppHandle, stream: &str, line: &str) {
    let _ = app.emit(
        "fcs-log",
        LogEvent {
            stream: stream.to_string(),
            line: line.to_string(),
        },
    );
}

fn stream_pipe<R: std::io::Read + Send + 'static>(pipe: R, stream: &str, app: AppHandle) {
    let stream = stream.to_string();
    let reader = BufReader::new(pipe);
    for line in reader.lines().map_while(Result::ok) {
        emit_log(&app, &stream, &line);
    }
}

fn stream_pipe_with_cancel<R: std::io::Read + Send + 'static>(
    pipe: R,
    stream: &str,
    app: AppHandle,
    cancel: Arc<AtomicBool>,
) {
    let stream = stream.to_string();
    let reader = BufReader::new(pipe);
    for line in reader.lines().map_while(Result::ok) {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        emit_log(&app, &stream, &line);
    }
}
