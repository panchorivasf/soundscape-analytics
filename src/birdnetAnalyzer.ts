import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { initBnaLocationMap, refreshBnaLocationMap } from "./bnaLocationMap";
import { loadBirdnetFromPaths, switchToBirdnetTab } from "./birdnetViewer";

const PYTHON_KEY = "soundecology.bna.python";

interface BirdnetDetectResult {
  available: boolean;
  command: string;
  argsPrefix: string[];
  versionHint: string;
  installHint: string;
  resolvedCommand: string;
  canInstall: boolean;
  installPython: string | null;
  installPythonVersion: string | null;
}

interface BirdnetInstallResult {
  success: boolean;
  exitCode: number | null;
  message: string;
  pythonUsed: string;
  cancelled: boolean;
}

interface BirdnetAnalyzeResult {
  success: boolean;
  exitCode: number | null;
  message: string;
  outputFolder: string;
  cancelled: boolean;
}

interface LogEvent {
  stream: string;
  line: string;
}

let inputFolder = "";
let outputFolder = "";
let lastOutputFolder = "";
let logUnlisten: UnlistenFn | null = null;
let running = false;
let installing = false;

const $ = (id: string) => document.getElementById(id)!;

export function initBirdnetAnalyzer(getToolbarFolder: () => string | null): void {
  initBnaLocationMap();

  $("bna-pick-input")?.addEventListener("click", () => void pickInput());
  $("bna-pick-output")?.addEventListener("click", () => void pickOutput());
  $("bna-use-toolbar")?.addEventListener("click", () => useToolbarFolder(getToolbarFolder()));
  $("bna-run")?.addEventListener("click", () => void runAnalysis());
  $("bna-cancel")?.addEventListener("click", () => void cancelAnalysis());
  $("bna-open-viz")?.addEventListener("click", () => void openInVisualizer());
  $("bna-refresh-detect")?.addEventListener("click", () => void refreshDetection());
  $("bna-clear-python")?.addEventListener("click", () => clearPythonPath());
  $("bna-copy-cite")?.addEventListener("click", () => void copyBibtex());
  $("bna-install")?.addEventListener("click", () => void installBirdnet());
  $("bna-pick-python")?.addEventListener("click", () => void pickPythonExecutable());

  const savedPy = localStorage.getItem(PYTHON_KEY);
  if (savedPy) ($("bna-python") as HTMLInputElement).value = savedPy;

  $("bna-python")?.addEventListener("change", () => {
    const v = ($("bna-python") as HTMLInputElement).value.trim();
    if (v) localStorage.setItem(PYTHON_KEY, v);
    else localStorage.removeItem(PYTHON_KEY);
    void refreshDetection();
  });

  document.querySelectorAll(".main-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if ((tab as HTMLElement).dataset.tab === "birdnet-analyzer") {
        void refreshDetection();
        refreshBnaLocationMap();
      }
    });
  });

  void refreshDetection();
  updatePathSummary();
}

function clearPythonPath(): void {
  ($("bna-python") as HTMLInputElement).value = "";
  localStorage.removeItem(PYTHON_KEY);
  void refreshDetection();
  setBnaStatus("Python path cleared — using auto-detection.", "ok");
}

async function copyBibtex(): Promise<void> {
  const text = ($("bna-bibtex") as HTMLElement).textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    setBnaStatus("BibTeX copied to clipboard.", "ok");
  } catch {
    setBnaStatus("Could not copy — select the BibTeX block manually.", "error");
  }
}

async function pickPythonExecutable(): Promise<void> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Python", extensions: ["exe"] }],
    title: "Select Python executable (python.exe)",
  });
  if (!picked || Array.isArray(picked)) return;
  ($("bna-python") as HTMLInputElement).value = picked;
  localStorage.setItem(PYTHON_KEY, picked);
  void refreshDetection();
}

async function installBirdnet(): Promise<void> {
  if (installing || running) return;

  installing = true;
  setRunningUi(true);
  setBnaStatus("Installing BirdNET Analyzer via pip…", "");
  appendLog("\n=== BirdNET Analyzer installation ===\n");

  if (logUnlisten) {
    await logUnlisten();
    logUnlisten = null;
  }
  logUnlisten = await listen<LogEvent>("birdnet-analyze-log", (ev) => {
    const prefix = ev.payload.stream === "stderr" ? "[err] " : "";
    appendLog(prefix + ev.payload.line);
  });

  try {
    const result = await invoke<BirdnetInstallResult>("install_birdnet_analyzer", {
      request: { python: readPython() || null },
    });

    appendLog(`\n${result.message}\n`);
    setBnaStatus(result.message, result.success ? "ok" : "error");

    if (result.success && result.pythonUsed) {
      ($("bna-python") as HTMLInputElement).value = result.pythonUsed;
      localStorage.setItem(PYTHON_KEY, result.pythonUsed);
    }

    await refreshDetection();
  } catch (e) {
    appendLog(`\nInstall error: ${String(e)}\n`);
    setBnaStatus(String(e), "error");
  } finally {
    installing = false;
    setRunningUi(false);
    if (logUnlisten) {
      await logUnlisten();
      logUnlisten = null;
    }
    void refreshDetection();
  }
}

async function refreshDetection(): Promise<void> {
  const el = $("bna-detect");
  const resolvedEl = $("bna-resolved-cmd");
  const installRow = $("bna-install-row");
  const installTarget = $("bna-install-target");
  el.textContent = "Checking installation…";
  el.className = "bna-detect";
  resolvedEl.textContent = "";

  try {
    const python = readPython();
    const info = await invoke<BirdnetDetectResult>("detect_birdnet_analyzer", {
      python: python || null,
    });
    if (info.available) {
      el.textContent = `Ready: ${info.versionHint || info.command}`;
      el.className = "bna-detect ok";
      resolvedEl.textContent = info.resolvedCommand
        ? `Command: ${info.resolvedCommand} …`
        : "";
      installRow.hidden = true;
      ($("bna-run") as HTMLButtonElement).disabled = running || installing;
      ($("bna-install") as HTMLButtonElement).disabled = true;
    } else {
      el.textContent = info.installHint.replace(/\n/g, " · ");
      el.className = "bna-detect err";
      installRow.hidden = !info.canInstall;
      if (info.canInstall && info.installPython) {
        installTarget.textContent = info.installPythonVersion
          ? `Will install into Python ${info.installPythonVersion}: ${info.installPython}`
          : `Will install into: ${info.installPython}`;
      } else {
        installTarget.textContent =
          "Install Python 3.11+ with pip, or use Choose Python… to select python.exe, then click Install.";
      }
      ($("bna-run") as HTMLButtonElement).disabled = true;
      ($("bna-install") as HTMLButtonElement).disabled =
        !info.canInstall || installing || running;
    }
  } catch (e) {
    el.textContent = String(e);
    el.className = "bna-detect err";
    installRow.hidden = true;
    ($("bna-run") as HTMLButtonElement).disabled = true;
  }
}

async function pickInput(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (folder && typeof folder === "string") {
    inputFolder = folder;
    if (!outputFolder) outputFolder = folder;
    updatePathSummary();
  }
}

async function pickOutput(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (folder && typeof folder === "string") {
    outputFolder = folder;
    updatePathSummary();
  }
}

function useToolbarFolder(folder: string | null): void {
  if (!folder) {
    setBnaStatus("Select a WAV folder in the toolbar first.", "error");
    return;
  }
  inputFolder = folder;
  if (!outputFolder) outputFolder = folder;
  updatePathSummary();
  setBnaStatus("Using toolbar folder as input.", "ok");
}

function updatePathSummary(): void {
  const el = $("bna-paths");
  if (!inputFolder && !outputFolder) {
    el.textContent = "No folders selected";
    return;
  }
  const inName = inputFolder.split(/[/\\]/).pop() ?? inputFolder;
  const outName = outputFolder.split(/[/\\]/).pop() ?? outputFolder;
  el.textContent =
    inputFolder === outputFolder || !outputFolder
      ? `Input & output: ${inName}`
      : `Input: ${inName} · Output: ${outName}`;
}

function readPython(): string {
  return ($("bna-python") as HTMLInputElement).value.trim();
}

function readOptionalInt(id: string): number | null {
  const raw = ($(id) as HTMLInputElement).value.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readOptionalFloat(id: string): number | null {
  const raw = ($(id) as HTMLInputElement).value.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function runAnalysis(): Promise<void> {
  if (!inputFolder) {
    setBnaStatus("Select an input folder with WAV files.", "error");
    return;
  }

  await refreshDetection();
  if (($("bna-run") as HTMLButtonElement).disabled && !running) {
    setBnaStatus("BirdNET is not available in the selected Python environment.", "error");
    return;
  }

  const out = outputFolder || inputFolder;
  appendLog(`Starting BirdNET analysis…\nInput: ${inputFolder}\nOutput: ${out}\n`);

  running = true;
  setRunningUi(true);
  setBnaStatus("Running BirdNET Analyzer…", "");

  if (logUnlisten) {
    await logUnlisten();
    logUnlisten = null;
  }
  logUnlisten = await listen<LogEvent>("birdnet-analyze-log", (ev) => {
    const prefix = ev.payload.stream === "stderr" ? "[err] " : "";
    appendLog(prefix + ev.payload.line);
  });

  try {
    const result = await invoke<BirdnetAnalyzeResult>("run_birdnet_analyze", {
      request: {
        input: inputFolder,
        output: out,
        python: readPython() || null,
        minConf: Number(($("bna-min-conf") as HTMLInputElement).value) || 0.25,
        overlap: Number(($("bna-overlap") as HTMLInputElement).value) || 0,
        batchSize: readOptionalInt("bna-batch-size"),
        nWorkers: readOptionalInt("bna-workers"),
        lat: readOptionalFloat("bna-lat"),
        lon: readOptionalFloat("bna-lon"),
        week: readOptionalInt("bna-week"),
        locale: ($("bna-locale") as HTMLSelectElement).value,
        splitTables: ($("bna-split-tables") as HTMLInputElement).checked,
        fmin: readOptionalInt("bna-fmin"),
        fmax: readOptionalInt("bna-fmax"),
        sensitivity: readOptionalFloat("bna-sensitivity"),
      },
    });

    lastOutputFolder = result.outputFolder;
    appendLog(`\n${result.message}\n`);
    setBnaStatus(result.message, result.success ? "ok" : "error");
    ($("bna-open-viz") as HTMLButtonElement).disabled = !result.success;
  } catch (e) {
    appendLog(`\nError: ${String(e)}\n`);
    setBnaStatus(String(e), "error");
  } finally {
    running = false;
    setRunningUi(false);
    if (logUnlisten) {
      await logUnlisten();
      logUnlisten = null;
    }
    void refreshDetection();
  }
}

async function cancelAnalysis(): Promise<void> {
  try {
    await invoke("cancel_birdnet_analyze");
    appendLog("\nCancellation requested…\n");
    setBnaStatus("Cancelling…", "");
  } catch (e) {
    setBnaStatus(String(e), "error");
  }
}

async function openInVisualizer(): Promise<void> {
  const folder = lastOutputFolder || outputFolder || inputFolder;
  if (!folder) return;
  setBnaStatus("Loading results into BirdNet Visualizer…", "");
  try {
    const paths = await invoke<string[]>("list_birdnet_in_folder", {
      folder,
      recursive: true,
    });
    if (paths.length === 0) {
      setBnaStatus("No CSV/TXT result files found in output folder.", "error");
      return;
    }
    await loadBirdnetFromPaths(paths);
    const minConf = ($("bna-min-conf") as HTMLInputElement | null)?.value;
    if (minConf) ($("bn-conf") as HTMLInputElement).value = minConf;
    switchToBirdnetTab();
    setBnaStatus(`Loaded ${paths.length} result file(s) in BirdNet Visualizer.`, "ok");
  } catch (e) {
    setBnaStatus(String(e), "error");
  }
}

function setRunningUi(active: boolean): void {
  ($("bna-run") as HTMLButtonElement).disabled = active || installing;
  ($("bna-cancel") as HTMLButtonElement).disabled = !active;
  ($("bna-install") as HTMLButtonElement).disabled =
    active || installing || ($("bna-install-row") as HTMLElement).hidden;
}

function appendLog(text: string): void {
  const el = $("bna-log");
  if (el.textContent === "Ready.") el.textContent = "";
  el.textContent += text + (text.endsWith("\n") ? "" : "\n");
  el.scrollTop = el.scrollHeight;
}

function setBnaStatus(msg: string, kind: "ok" | "error" | ""): void {
  const el = $("bna-status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}
