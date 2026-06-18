use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BirdnetDetectResult {
    pub available: bool,
    pub command: String,
    pub args_prefix: Vec<String>,
    pub version_hint: String,
    pub install_hint: String,
    /// Human-readable command that will be executed (for UI display).
    pub resolved_command: String,
    /// Whether the app can run pip install automatically.
    pub can_install: bool,
    /// Python executable that would be used for auto-install (full path).
    pub install_python: Option<String>,
    pub install_python_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BirdnetInstallRequest {
    pub python: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BirdnetInstallResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
    pub python_used: String,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BirdnetAnalyzeRequest {
    pub input: String,
    pub output: Option<String>,
    /// Optional Python executable; when set, tries Scripts/birdnet-analyze first, then python -m.
    pub python: Option<String>,
    pub min_conf: f64,
    pub overlap: f64,
    pub batch_size: Option<u32>,
    pub n_workers: Option<u32>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub week: Option<i32>,
    pub locale: Option<String>,
    pub split_tables: bool,
    pub fmin: Option<u32>,
    pub fmax: Option<u32>,
    pub sensitivity: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BirdnetAnalyzeResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub message: String,
    pub output_folder: String,
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    stream: String,
    line: String,
}

struct ResolvedRunner {
    command: String,
    args_prefix: Vec<String>,
    version_hint: String,
}

#[derive(Clone)]
struct PythonEnv {
    command: String,
    prefix_args: Vec<String>,
    executable: String,
    version: String,
}

struct RunningJob {
    child: std::process::Child,
    cancel: Arc<AtomicBool>,
}

static RUNNING: Mutex<Option<RunningJob>> = Mutex::new(None);

const INSTALL_HINT: &str =
    "Install BirdNET-Analyzer with Python 3.11+: pip install birdnet-analyzer";

pub fn detect_birdnet(python: Option<String>) -> BirdnetDetectResult {
    if let Some(resolved) = resolve_runner(python.as_deref()) {
        let resolved_command = format_command(&resolved.command, &resolved.args_prefix);
        return BirdnetDetectResult {
            available: true,
            command: resolved.command,
            args_prefix: resolved.args_prefix,
            version_hint: resolved.version_hint,
            install_hint: INSTALL_HINT.to_string(),
            resolved_command,
            can_install: false,
            install_python: None,
            install_python_version: None,
        };
    }

    let install_env = find_python_for_install(python.as_deref());
    let can_install = install_env.is_some();

    let custom_hint = python
        .as_ref()
        .filter(|s| !s.trim().is_empty())
        .map(|py| {
            if can_install {
                format!(
                    "BirdNET not found in `{py}`. Click Install BirdNET Analyzer to install via pip, or clear the Python path to use another environment."
                )
            } else {
                format!(
                    "Could not find BirdNET or a suitable Python 3.11+ with pip in `{py}`.\nInstall Python 3.11+ and pip, or pick another Python executable."
                )
            }
        });

    BirdnetDetectResult {
        available: false,
        command: python.clone().unwrap_or_default(),
        args_prefix: vec![],
        version_hint: String::new(),
        install_hint: custom_hint.unwrap_or_else(|| {
            if can_install {
                "BirdNET Analyzer CLI not found. Click Install BirdNET Analyzer to download and install it (requires internet; may take several minutes).".to_string()
            } else {
                format!(
                    "{INSTALL_HINT}\nNo Python 3.11+ with pip was found automatically. Install Python 3.11+ from python.org or conda, then use Install BirdNET Analyzer."
                )
            }
        }),
        resolved_command: String::new(),
        can_install,
        install_python: install_env.as_ref().map(|e| e.executable.clone()),
        install_python_version: install_env.as_ref().map(|e| e.version.clone()),
    }
}

fn resolve_runner(custom_python: Option<&str>) -> Option<ResolvedRunner> {
    if let Some(py) = custom_python.filter(|s| !s.trim().is_empty()) {
        let py = py.trim();
        if let Some(script) = birdnet_analyze_script_for_python(py) {
            if probe_birdnet_analyze_exe(&script) {
                return Some(ResolvedRunner {
                    command: script.clone(),
                    args_prefix: vec![],
                    version_hint: format!("{script} (next to Python)"),
                });
            }
        }
        if let Some(hint) = probe_python_import(py) {
            return Some(ResolvedRunner {
                command: py.to_string(),
                args_prefix: vec![
                    "-m".to_string(),
                    "birdnet_analyzer.analyze.cli".to_string(),
                ],
                version_hint: hint,
            });
        }
        return None;
    }

    if probe_birdnet_analyze_exe("birdnet-analyze") {
        return Some(ResolvedRunner {
            command: "birdnet-analyze".to_string(),
            args_prefix: vec![],
            version_hint: "birdnet-analyze (PATH)".to_string(),
        });
    }

    for py in default_python_candidates() {
        if let Some(script) = birdnet_analyze_script_for_python_name(&py) {
            if probe_birdnet_analyze_exe(&script) {
                return Some(ResolvedRunner {
                    command: script.clone(),
                    args_prefix: vec![],
                    version_hint: format!("{script}"),
                });
            }
        }
        if let Some(hint) = probe_python_import(&py) {
            return Some(ResolvedRunner {
                command: py,
                args_prefix: vec![
                    "-m".to_string(),
                    "birdnet_analyzer.analyze.cli".to_string(),
                ],
                version_hint: hint,
            });
        }
    }

    None
}

fn format_command(command: &str, args_prefix: &[String]) -> String {
    if args_prefix.is_empty() {
        command.to_string()
    } else {
        format!("{command} {}", args_prefix.join(" "))
    }
}

fn default_python_candidates() -> Vec<String> {
    let mut out = vec!["python".to_string(), "python3".to_string()];
    if cfg!(windows) {
        out.push("py".to_string());
    }
    out
}

fn install_launcher_candidates(custom: Option<&str>) -> Vec<(String, Vec<String>)> {
    if let Some(py) = custom.filter(|s| !s.trim().is_empty()) {
        return vec![(py.trim().to_string(), vec![])];
    }

    let mut out = Vec::new();
    if cfg!(windows) {
        out.push(("py".to_string(), vec!["-3.12".to_string()]));
        out.push(("py".to_string(), vec!["-3.11".to_string()]));
    }
    out.push(("python3.12".to_string(), vec![]));
    out.push(("python3.11".to_string(), vec![]));
    out.push(("python".to_string(), vec![]));
    out.push(("python3".to_string(), vec![]));
    out
}

fn find_python_for_install(custom: Option<&str>) -> Option<PythonEnv> {
    for (command, prefix_args) in install_launcher_candidates(custom) {
        if let Some(env) = probe_python_env(&command, &prefix_args) {
            return Some(env);
        }
    }
    None
}

fn probe_python_env(command: &str, prefix_args: &[String]) -> Option<PythonEnv> {
    let version_script = "import sys; v=sys.version_info; print(sys.executable); print(f'{v.major}.{v.minor}.{v.micro}'); raise SystemExit(0 if v>=(3,11) else 1)";

    let mut version_cmd = Command::new(command);
    version_cmd
        .args(prefix_args)
        .args(["-c", version_script])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let version_out = version_cmd.output().ok()?;
    if !version_out.status.success() {
        return None;
    }

    let stdout_text = String::from_utf8_lossy(&version_out.stdout);
    let mut lines = stdout_text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    let executable = lines.next()?.to_string();
    let version = lines.next()?.to_string();

    let mut pip_cmd = Command::new(command);
    pip_cmd
        .args(prefix_args)
        .args(["-m", "pip", "--version"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let pip_out = pip_cmd.output().ok()?;
    if !pip_out.status.success() {
        return None;
    }

    Some(PythonEnv {
        command: command.to_string(),
        prefix_args: prefix_args.to_vec(),
        executable,
        version,
    })
}

fn spawn_pip_install(env: &PythonEnv) -> Result<std::process::Child, String> {
    let mut cmd = Command::new(&env.command);
    cmd.args(&env.prefix_args)
        .args([
            "-m",
            "pip",
            "install",
            "--upgrade",
            "birdnet-analyzer",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to start pip install with {}: {e}",
            env.executable
        )
    })
}

pub fn install_birdnet_analyzer(
    app: AppHandle,
    python: Option<String>,
) -> Result<BirdnetInstallResult, String> {
    let env = find_python_for_install(python.as_deref()).ok_or_else(|| {
        "No Python 3.11+ with pip found. Install Python 3.11+ or set the Python executable field.".to_string()
    })?;

    {
        let guard = RUNNING.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("A BirdNET install or analysis job is already running".into());
        }
    }

    let pip_label = format!(
        "{} {} -m pip install --upgrade birdnet-analyzer",
        env.command,
        env.prefix_args.join(" ")
    )
    .trim()
    .to_string();
    let _ = app.emit(
        "birdnet-analyze-log",
        LogEvent {
            stream: "stdout".to_string(),
            line: format!("Installing via: {pip_label}"),
        },
    );

    let mut child = spawn_pip_install(&env)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = RUNNING.lock().map_err(|e| e.to_string())?;
        *guard = Some(RunningJob {
            child,
            cancel: Arc::clone(&cancel),
        });
    }

    if let Some(out) = stdout {
        let app_log = app.clone();
        let cancel_flag = Arc::clone(&cancel);
        thread::spawn(move || stream_lines(out, "stdout", app_log, cancel_flag));
    }
    if let Some(err) = stderr {
        let app_log = app.clone();
        thread::spawn(move || stream_lines(err, "stderr", app_log, Arc::new(AtomicBool::new(false))));
    }

    let wait = wait_for_job(&cancel);
    match wait {
        JobWaitResult::Cancelled => Ok(BirdnetInstallResult {
            success: false,
            exit_code: None,
            message: "Installation cancelled.".into(),
            python_used: env.executable.clone(),
            cancelled: true,
        }),
        JobWaitResult::Failed(e) => Err(e),
        JobWaitResult::Finished(status) => {
            let code = status.code();
            if !status.success() {
                return Ok(BirdnetInstallResult {
                    success: false,
                    exit_code: code,
                    message: format!(
                        "pip install failed (exit {code:?}). See log for details."
                    ),
                    python_used: env.executable.clone(),
                    cancelled: false,
                });
            }

            if !verify_birdnet_in_python(&env.executable) {
                return Ok(BirdnetInstallResult {
                    success: false,
                    exit_code: code,
                    message: format!(
                        "pip finished but BirdNET could not be verified in {}. Try Refresh detection or restart the app.",
                        env.executable
                    ),
                    python_used: env.executable.clone(),
                    cancelled: false,
                });
            }

            Ok(BirdnetInstallResult {
                success: true,
                exit_code: code,
                message: format!(
                    "BirdNET Analyzer installed successfully in Python {} ({}).",
                    env.version, env.executable
                ),
                python_used: env.executable.clone(),
                cancelled: false,
            })
        }
    }
}

enum JobWaitResult {
    Finished(std::process::ExitStatus),
    Cancelled,
    Failed(String),
}

fn wait_for_job(cancel: &Arc<AtomicBool>) -> JobWaitResult {
    loop {
        let mut guard = match RUNNING.lock() {
            Ok(g) => g,
            Err(e) => return JobWaitResult::Failed(e.to_string()),
        };
        let job = match guard.as_mut() {
            Some(j) => j,
            None => return JobWaitResult::Failed("BirdNET job not running".into()),
        };

        match job.child.try_wait() {
            Ok(Some(status)) => {
                *guard = None;
                return JobWaitResult::Finished(status);
            }
            Ok(None) => {
                if cancel.load(Ordering::SeqCst) {
                    let _ = job.child.kill();
                    let _ = job.child.wait();
                    *guard = None;
                    return JobWaitResult::Cancelled;
                }
            }
            Err(e) => {
                *guard = None;
                return JobWaitResult::Failed(format!("Failed waiting for process: {e}"));
            }
        }
        drop(guard);
        thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn verify_birdnet_in_python(executable: &str) -> bool {
    if probe_python_import(executable).is_some() {
        return true;
    }
    if let Some(script) = birdnet_analyze_script_for_python(executable) {
        return probe_birdnet_analyze_exe(&script);
    }
    false
}

fn birdnet_analyze_script_for_python(python: &str) -> Option<String> {
    let path = Path::new(python);
    if !path.is_absolute() {
        return None;
    }
    let parent = path.parent()?;
    let scripts = if cfg!(windows) {
        parent.join("Scripts").join("birdnet-analyze.exe")
    } else {
        parent.join("bin").join("birdnet-analyze")
    };
    if scripts.is_file() {
        Some(scripts.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn birdnet_analyze_script_for_python_name(name: &str) -> Option<String> {
    let output = Command::new(name)
        .arg("-c")
        .arg("import sys; print(sys.executable)")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let exe = String::from_utf8_lossy(&output.stdout).trim().to_string();
    birdnet_analyze_script_for_python(&exe)
}

fn probe_birdnet_analyze_exe(path: &str) -> bool {
    let output = Command::new(path)
        .arg("--help")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(out) => out.status.success() && !combined_output(&out).contains("ModuleNotFoundError"),
        Err(_) => false,
    }
}

fn probe_python_import(python: &str) -> Option<String> {
    let mut cmd = Command::new(python);
    if python == "py" && cfg!(windows) {
        cmd.arg("-3.11");
    }
    let output = cmd
        .args([
            "-c",
            "import birdnet_analyzer; print(getattr(birdnet_analyzer, '__version__', 'installed'))",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let combined = combined_output(&output);
    if combined.contains("ModuleNotFoundError") || combined.contains("No module named") {
        return None;
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        Some(format!("{python} (birdnet_analyzer installed)"))
    } else {
        Some(format!("{python} · birdnet_analyzer {version}"))
    }
}

fn combined_output(output: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn build_analyze_args(request: &BirdnetAnalyzeRequest, output_folder: &str) -> Vec<String> {
    let mut args = Vec::new();
    args.push(request.input.clone());
    args.push("-o".to_string());
    args.push(output_folder.to_string());
    args.push("--rtype".to_string());
    args.push("csv".to_string());
    args.push("--min_conf".to_string());
    args.push(format!("{}", request.min_conf.clamp(0.00001, 0.99)));
    args.push("--overlap".to_string());
    args.push(format!("{}", request.overlap.clamp(0.0, 4.9)));

    if let Some(v) = request.batch_size {
        args.push("-b".to_string());
        args.push(v.max(1).to_string());
    }
    if let Some(v) = request.n_workers {
        args.push("-t".to_string());
        args.push(v.max(1).to_string());
    }
    if let Some(v) = request.lat {
        args.push("--lat".to_string());
        args.push(v.to_string());
    }
    if let Some(v) = request.lon {
        args.push("--lon".to_string());
        args.push(v.to_string());
    }
    if let Some(v) = request.week {
        args.push("--week".to_string());
        args.push(v.to_string());
    }
    if let Some(locale) = request.locale.as_ref().filter(|s| !s.is_empty()) {
        args.push("-l".to_string());
        args.push(locale.clone());
    }
    if !request.split_tables {
        // BirdNET 2.4+: --combine_results (no --split_tables flag)
        args.push("--combine_results".to_string());
    }
    if let Some(v) = request.fmin {
        args.push("--fmin".to_string());
        args.push(v.to_string());
    }
    if let Some(v) = request.fmax {
        args.push("--fmax".to_string());
        args.push(v.to_string());
    }
    if let Some(v) = request.sensitivity {
        args.push("--sensitivity".to_string());
        args.push(format!("{}", v.clamp(0.5, 1.5)));
    }
    args
}

fn spawn_command(resolved: &ResolvedRunner, analyze_args: &[String]) -> Result<std::process::Child, String> {
    let mut cmd = Command::new(&resolved.command);
    if resolved.command == "py" && cfg!(windows) {
        cmd.arg("-3.11");
    }
    cmd.args(&resolved.args_prefix)
        .args(analyze_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to start {}: {e}\n{INSTALL_HINT}",
            resolved.command
        )
    })
}

pub fn run_birdnet_analyze(
    app: AppHandle,
    request: BirdnetAnalyzeRequest,
) -> Result<BirdnetAnalyzeResult, String> {
    if request.input.trim().is_empty() {
        return Err("input folder or file is required".into());
    }

    let detect = detect_birdnet(request.python.clone());
    if !detect.available {
        return Err(detect.install_hint);
    }

    let resolved = resolve_runner(request.python.as_deref())
        .ok_or_else(|| detect.install_hint.clone())?;

    {
        let guard = RUNNING.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("BirdNET analysis is already running".into());
        }
    }

    let output_folder = request
        .output
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| request.input.clone());

    let analyze_args = build_analyze_args(&request, &output_folder);
    let mut child = spawn_command(&resolved, &analyze_args)?;

    let cancel = Arc::new(AtomicBool::new(false));
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = RUNNING.lock().map_err(|e| e.to_string())?;
        *guard = Some(RunningJob {
            child,
            cancel: Arc::clone(&cancel),
        });
    }

    if let Some(out) = stdout {
        let app_log = app.clone();
        let cancel_flag = Arc::clone(&cancel);
        thread::spawn(move || stream_lines(out, "stdout", app_log, cancel_flag));
    }
    if let Some(err) = stderr {
        let app_log = app.clone();
        thread::spawn(move || stream_lines(err, "stderr", app_log, Arc::new(AtomicBool::new(false))));
    }

    let wait = wait_for_job(&cancel);
    let (success, exit_code, message, cancelled) = match wait {
        JobWaitResult::Cancelled => (
            false,
            None,
            "Analysis cancelled.".to_string(),
            true,
        ),
        JobWaitResult::Failed(e) => return Err(e),
        JobWaitResult::Finished(status) => {
            let code = status.code();
            let ok = status.success();
            let msg = if ok {
                format!("BirdNET analysis finished (exit {code:?}). Results in {output_folder}")
            } else {
                format!(
                    "BirdNET analysis failed (exit {code:?}). See log for details.\nIf you see ModuleNotFoundError, use Install BirdNET Analyzer or set the correct Python path."
                )
            };
            (ok, code, msg, false)
        }
    };

    Ok(BirdnetAnalyzeResult {
        success,
        exit_code,
        message,
        output_folder,
        cancelled,
    })
}

fn stream_lines<R: std::io::Read>(
    reader: R,
    stream: &str,
    app: AppHandle,
    cancel: Arc<AtomicBool>,
) {
    let buf = BufReader::new(reader);
    for line in buf.lines().map_while(Result::ok) {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let _ = app.emit(
            "birdnet-analyze-log",
            LogEvent {
                stream: stream.to_string(),
                line,
            },
        );
    }
}

pub fn cancel_birdnet_analyze() -> Result<(), String> {
    let mut guard = RUNNING.lock().map_err(|e| e.to_string())?;
    if let Some(job) = guard.as_mut() {
        job.cancel.store(true, Ordering::SeqCst);
        let _ = job.child.kill();
        Ok(())
    } else {
        Err("No BirdNET install or analysis job is running".into())
    }
}

pub fn birdnet_analyze_running() -> bool {
    RUNNING
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}