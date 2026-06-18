import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";

const AP_ROOT_KEY = "soundecology.fcs.apRoot";

interface ApDetectResult {
  available: boolean;
  apRoot: string;
  exePath: string;
  versionHint: string;
  installHint: string;
  canInstall: boolean;
  configOk: boolean;
}

interface ApInstallResult {
  success: boolean;
  exitCode: number | null;
  message: string;
  cancelled: boolean;
}

interface FcsComputeResult {
  success: boolean;
  exitCode: number | null;
  message: string;
  outputDirectory: string;
  segmentCount: number;
  filesProcessed: number;
  cancelled: boolean;
}

interface FcsPostprocessResult {
  success: boolean;
  message: string;
  segmentsDirectory: string;
  previewDirectory: string;
  previewPaths: string[];
  stepLog: string[];
  segmentCount: number;
}

interface FcsNamingConfig {
  delimiter: string;
  dateTokenIndex: number;
  dateFormat: string;
  timeTokenIndex: number;
  timeFormat: string;
}

interface FcsNamingPreview {
  filename: string;
  parsed: string | null;
  error: string | null;
}

interface FcsNamingProbe {
  exampleFilename: string;
  tokens: string[];
  config: FcsNamingConfig;
  parsedExample: string | null;
  previews: FcsNamingPreview[];
}

interface LogEvent {
  stream: string;
  line: string;
}

let inputFolder = "";
let outputFolder = "";
let segmentsFolder = "";
let audioFolder = "";
let lastPreviewDir = "";
let lastRibbonsDir = "";
let lastPlotsDir = "";
let previewPaths: string[] = [];
let previewIndex = 0;

let logUnlisten: UnlistenFn | null = null;
let computeRunning = false;
let postprocessRunning = false;
let installing = false;

const $ = (id: string) => document.getElementById(id)!;

export function initFalseColorSpectrograms(getToolbarFolder: () => string | null): void {
  $("fcs-pick-input")?.addEventListener("click", () => void pickInput());
  $("fcs-pick-output")?.addEventListener("click", () => void pickOutput());
  $("fcs-use-toolbar")?.addEventListener("click", () => useToolbarFolder(getToolbarFolder()));
  $("fcs-pick-segments")?.addEventListener("click", () => void pickSegments());
  $("fcs-use-output-segments")?.addEventListener("click", () => useOutputAsSegments());
  $("fcs-pick-audio")?.addEventListener("click", () => void pickAudioFolder());
  $("fcs-use-input-audio")?.addEventListener("click", () => useInputAsAudio());
  $("fcs-naming-refresh")?.addEventListener("click", () => void refreshNamingProbe());
  for (const id of [
    "fcs-naming-delimiter",
    "fcs-naming-date-idx",
    "fcs-naming-date-fmt",
    "fcs-naming-time-idx",
    "fcs-naming-time-fmt",
  ]) {
    $(id)?.addEventListener("change", () => void refreshNamingProbe());
  }
  $("fcs-run-compute")?.addEventListener("click", () => void runCompute());
  $("fcs-run-postprocess")?.addEventListener("click", () => void runPostprocess());
  $("fcs-cancel")?.addEventListener("click", () => void cancelCompute());
  $("fcs-refresh-detect")?.addEventListener("click", () => void refreshDetection());
  $("fcs-install")?.addEventListener("click", () => void installAp());
  $("fcs-copy-cite")?.addEventListener("click", () => void copyBibtex());
  $("fcs-open-output")?.addEventListener("click", () => void openFolder(outputFolder));
  $("fcs-open-ribbons")?.addEventListener("click", () => void openFolder(lastRibbonsDir));
  $("fcs-open-plots")?.addEventListener("click", () => void openFolder(lastPlotsDir));
  $("fcs-preview-prev")?.addEventListener("click", () => showPreview(previewIndex - 1));
  $("fcs-preview-next")?.addEventListener("click", () => showPreview(previewIndex + 1));

  const savedRoot = localStorage.getItem(AP_ROOT_KEY);
  if (savedRoot) ($("fcs-ap-root") as HTMLInputElement).value = savedRoot;

  $("fcs-ap-root")?.addEventListener("change", () => {
    const v = ($("fcs-ap-root") as HTMLInputElement).value.trim();
    if (v) localStorage.setItem(AP_ROOT_KEY, v);
    else localStorage.removeItem(AP_ROOT_KEY);
    void refreshDetection();
  });

  document.querySelectorAll(".main-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if ((tab as HTMLElement).dataset.tab === "falsecolor") {
        void refreshDetection();
      }
    });
  });

  void refreshDetection();
  updatePathSummary();
  updateSegmentsSummary();
}

function readApRoot(): string | null {
  const v = ($("fcs-ap-root") as HTMLInputElement).value.trim();
  return v || null;
}

async function refreshDetection(): Promise<void> {
  const el = $("fcs-detect");
  const installRow = $("fcs-install-row") as HTMLElement;
  el.textContent = "Checking AnalysisPrograms.exe…";
  el.className = "fcs-detect";

  try {
    const result = await invoke<ApDetectResult>("detect_analysis_programs", {
      apRoot: readApRoot(),
    });

    if (result.available) {
      el.textContent = `Ready — ${result.versionHint} (${result.exePath})`;
      el.className = "fcs-detect ok";
      installRow.hidden = true;
    } else if (result.exePath && !result.configOk) {
      el.textContent = result.installHint;
      el.className = "fcs-detect err";
      installRow.hidden = !result.canInstall;
    } else {
      el.textContent = result.installHint;
      el.className = "fcs-detect err";
      installRow.hidden = !result.canInstall;
    }

    ($("fcs-ap-root") as HTMLInputElement).placeholder = result.apRoot;
  } catch (e) {
    el.textContent = String(e);
    el.className = "fcs-detect err";
    installRow.hidden = true;
  }
}

async function installAp(): Promise<void> {
  if (installing || computeRunning) return;

  installing = true;
  setRunningUi();
  setFcsStatus("Installing AnalysisPrograms.exe to C:\\AP…", "");
  appendLog("\n=== AnalysisPrograms.exe installation ===\n");

  if (logUnlisten) {
    await logUnlisten();
    logUnlisten = null;
  }
  logUnlisten = await listen<LogEvent>("fcs-log", (ev) => {
    const prefix = ev.payload.stream === "stderr" ? "[err] " : "";
    appendLog(prefix + ev.payload.line);
  });

  try {
    const result = await invoke<ApInstallResult>("install_analysis_programs");
    appendLog(`\n${result.message}\n`);
    setFcsStatus(result.message, result.success ? "ok" : "error");
    await refreshDetection();
  } catch (e) {
    appendLog(`\nInstall error: ${String(e)}\n`);
    setFcsStatus(String(e), "error");
  } finally {
    installing = false;
    setRunningUi();
  }
}

async function pickInput(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (!folder || Array.isArray(folder)) return;
  inputFolder = folder;
  updatePathSummary();
}

async function pickOutput(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (!folder || Array.isArray(folder)) return;
  outputFolder = folder;
  updatePathSummary();
}

async function pickSegments(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (!folder || Array.isArray(folder)) return;
  segmentsFolder = folder;
  syncFolderPathsFromSegments();
  await updateSegmentsSummary();
  await refreshNamingProbe();
}

async function pickAudioFolder(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (!folder || Array.isArray(folder)) return;
  audioFolder = folder;
  updateAudioSummary();
}

function useInputAsAudio(): void {
  if (!inputFolder) {
    setFcsStatus("Select the AP audio input folder first.", "error");
    return;
  }
  audioFolder = inputFolder;
  updateAudioSummary();
  setFcsStatus("Using AP input folder for recording durations.", "ok");
}

function updateAudioSummary(): void {
  const el = $("fcs-audio-summary");
  el.textContent = audioFolder
    ? `Audio folder: ${basename(audioFolder)} (WAV duration lookup)`
    : "Audio folder: not set (uses fcs_manifest.json when available)";
}

function readNamingConfig(): FcsNamingConfig {
  return {
    delimiter: ($("fcs-naming-delimiter") as HTMLInputElement).value || "_",
    dateTokenIndex: Number(($("fcs-naming-date-idx") as HTMLSelectElement).value) || 1,
    dateFormat: ($("fcs-naming-date-fmt") as HTMLSelectElement).value,
    timeTokenIndex: Number(($("fcs-naming-time-idx") as HTMLSelectElement).value) || 2,
    timeFormat: ($("fcs-naming-time-fmt") as HTMLSelectElement).value,
  };
}

function populateTokenSelects(tokens: string[], config: FcsNamingConfig): void {
  const dateSel = $("fcs-naming-date-idx") as HTMLSelectElement;
  const timeSel = $("fcs-naming-time-idx") as HTMLSelectElement;
  dateSel.innerHTML = "";
  timeSel.innerHTML = "";
  tokens.forEach((tok, i) => {
    const label = `"${tok}" (#${i})`;
    for (const sel of [dateSel, timeSel]) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = label;
      sel.appendChild(opt);
    }
  });
  if (tokens.length === 0) return;
  dateSel.value = String(Math.min(config.dateTokenIndex, tokens.length - 1));
  timeSel.value = String(Math.min(config.timeTokenIndex, tokens.length - 1));
  ($("fcs-naming-delimiter") as HTMLInputElement).value = config.delimiter;
  ($("fcs-naming-date-fmt") as HTMLSelectElement).value = config.dateFormat;
  ($("fcs-naming-time-fmt") as HTMLSelectElement).value = config.timeFormat;
}

function renderNamingPreview(probe: FcsNamingProbe): void {
  ($("fcs-naming-example") as HTMLElement).textContent = probe.exampleFilename
    ? `Example: ${probe.exampleFilename}`
    : "—";
  const list = $("fcs-naming-preview");
  list.innerHTML = "";
  for (const row of probe.previews) {
    const li = document.createElement("li");
    li.textContent = row.parsed
      ? `${row.filename} → ${row.parsed}`
      : `${row.filename} → ${row.error ?? "unparsed"}`;
    li.className = row.parsed ? "ok" : "err";
    list.appendChild(li);
  }
}

async function refreshNamingProbe(): Promise<void> {
  if (!segmentsFolder) {
    ($("fcs-naming-example") as HTMLElement).textContent = "—";
    ($("fcs-naming-preview") as HTMLElement).innerHTML = "";
    return;
  }
  try {
    const probe = await invoke<FcsNamingProbe>("probe_fcs_naming", {
      segmentsDirectory: segmentsFolder,
      config:
        ($("fcs-naming-date-idx") as HTMLSelectElement).options.length > 0
          ? readNamingConfig()
          : null,
    });
    populateTokenSelects(probe.tokens, probe.config);
    renderNamingPreview(probe);
  } catch (e) {
    ($("fcs-naming-example") as HTMLElement).textContent = String(e);
  }
}

function useToolbarFolder(folder: string | null): void {
  if (!folder) {
    setFcsStatus("No folder in toolbar — select WAV files or a folder first.", "error");
    return;
  }
  inputFolder = folder;
  updatePathSummary();
  setFcsStatus("Using toolbar folder as audio input.", "ok");
}

function useOutputAsSegments(): void {
  if (!outputFolder) {
    setFcsStatus("Run AP compute first or pick an output folder.", "error");
    return;
  }
  segmentsFolder = outputFolder;
  syncFolderPathsFromSegments();
  void updateSegmentsSummary();
  void refreshNamingProbe();
  setFcsStatus("Using AP output folder for post-processing.", "ok");
}

function syncFolderPathsFromSegments(): void {
  if (!segmentsFolder) return;
  lastRibbonsDir = `${segmentsFolder}\\diel_ribbons`;
  lastPlotsDir = `${segmentsFolder}\\diel_fcs_plots`;
}

function updatePathSummary(): void {
  const el = $("fcs-paths");
  const inLabel = inputFolder ? basename(inputFolder) : "—";
  const outLabel = outputFolder ? basename(outputFolder) : "—";
  el.textContent = `Input: ${inLabel} · Output: ${outLabel}`;
  ($("fcs-open-output") as HTMLButtonElement).disabled = !outputFolder;
}

async function updateSegmentsSummary(): Promise<void> {
  const el = $("fcs-segments-summary");
  if (!segmentsFolder) {
    el.textContent = "No segments folder selected";
    return;
  }

  try {
    const count = await invoke<number>("count_fcs_segments", {
      segmentsDirectory: segmentsFolder,
    });
    el.textContent = `${basename(segmentsFolder)} — ${count} segment tile(s)`;
  } catch {
    el.textContent = basename(segmentsFolder);
  }
}

async function runCompute(): Promise<void> {
  if (computeRunning || installing || postprocessRunning) return;
  if (!inputFolder) {
    setFcsStatus("Select an audio input folder.", "error");
    return;
  }
  if (!outputFolder) {
    setFcsStatus("Select an output folder.", "error");
    return;
  }

  computeRunning = true;
  setRunningUi();
  setFcsStatus("Running AP compute…", "");
  appendLog("\n=== Step 1: AP compute (fcs_compute) ===\n");

  if (logUnlisten) {
    await logUnlisten();
    logUnlisten = null;
  }
  logUnlisten = await listen<LogEvent>("fcs-log", (ev) => {
    const prefix = ev.payload.stream === "stderr" ? "[err] " : "";
    appendLog(prefix + ev.payload.line);
  });

  try {
    const result = await invoke<FcsComputeResult>("run_fcs_compute", {
      request: {
        audioDirectory: inputFolder,
        outputDirectory: outputFolder,
        apRoot: readApRoot(),
        addHiRes: ($("fcs-hires") as HTMLInputElement).checked,
      },
    });

    appendLog(`\n${result.message}\n`);
    setFcsStatus(result.message, result.success ? "ok" : "error");

    if (result.success && result.segmentCount > 0) {
      segmentsFolder = result.outputDirectory;
      if (!audioFolder) audioFolder = inputFolder;
      syncFolderPathsFromSegments();
      updateAudioSummary();
      await updateSegmentsSummary();
      await refreshNamingProbe();
      setFcsStatus(
        `${result.message} Run post-processing (step 2) to build daily plots.`,
        "ok",
      );
    }
  } catch (e) {
    appendLog(`\nError: ${String(e)}\n`);
    setFcsStatus(String(e), "error");
  } finally {
    computeRunning = false;
    setRunningUi();
  }
}

async function runPostprocess(): Promise<void> {
  if (postprocessRunning || computeRunning || installing) return;
  if (!segmentsFolder) {
    setFcsStatus("Select the folder with raw segment FCS tiles.", "error");
    return;
  }

  const bind = ($("fcs-bind") as HTMLInputElement).checked;
  const grid = ($("fcs-grid") as HTMLInputElement).checked;
  if (!bind && !($("fcs-fill") as HTMLInputElement).checked && !($("fcs-organize") as HTMLInputElement).checked) {
    setFcsStatus("Select at least one post-processing step.", "error");
    return;
  }
  if (grid && !bind) {
    setFcsStatus("fcs_grid requires fcs_bind (diel ribbons).", "error");
    return;
  }

  postprocessRunning = true;
  setRunningUi();
  setFcsStatus("Running falsecoloR post-processing…", "");
  appendLog("\n=== Step 2: falsecoloR post-processing ===\n");

  try {
    const result = await invoke<FcsPostprocessResult>("run_fcs_postprocess", {
      request: {
        segmentsDirectory: segmentsFolder,
        audioDirectory: audioFolder || null,
        naming: readNamingConfig(),
        organize: ($("fcs-organize") as HTMLInputElement).checked,
        fill: ($("fcs-fill") as HTMLInputElement).checked,
        bind,
        grid,
        editTopCrop: Number(($("fcs-top-crop") as HTMLInputElement).value) || 41,
        editBottomCrop: Number(($("fcs-bottom-crop") as HTMLInputElement).value) || 18,
      },
    });

    for (const line of result.stepLog) appendLog(line);
    appendLog(`\n${result.message}\n`);

    lastPreviewDir = result.previewDirectory;
    syncFolderPathsFromSegments();
    updateFolderButtons(result.previewPaths.length > 0);

    if (result.previewPaths.length > 0) {
      setPreviewGallery(result.previewPaths);
      updatePlotsSummary(result.previewPaths);
    } else {
      clearPreviewGallery();
    }

    setFcsStatus(result.message, result.success ? "ok" : "error");
    await updateSegmentsSummary();
  } catch (e) {
    appendLog(`\nError: ${String(e)}\n`);
    setFcsStatus(String(e), "error");
  } finally {
    postprocessRunning = false;
    setRunningUi();
  }
}

async function cancelCompute(): Promise<void> {
  try {
    await invoke("cancel_fcs_compute");
    setFcsStatus("Cancelling…", "");
  } catch (e) {
    setFcsStatus(String(e), "error");
  }
}

function setPreviewGallery(paths: string[]): void {
  previewPaths = paths;
  previewIndex = 0;
  ($("fcs-preview-empty") as HTMLElement).hidden = true;
  ($("fcs-preview") as HTMLElement).hidden = false;
  renderPreviewThumbs();
  showPreview(0);
}

function clearPreviewGallery(): void {
  previewPaths = [];
  previewIndex = 0;
  ($("fcs-preview-empty") as HTMLElement).hidden = false;
  ($("fcs-preview") as HTMLElement).hidden = true;
  ($("fcs-preview-thumbs") as HTMLElement).innerHTML = "";
  ($("fcs-preview-img") as HTMLImageElement).removeAttribute("src");
}

function renderPreviewThumbs(): void {
  const host = $("fcs-preview-thumbs");
  host.innerHTML = "";
  previewPaths.forEach((path, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fcs-preview-thumb";
    btn.textContent = basename(path, ".png");
    btn.addEventListener("click", () => showPreview(i));
    host.appendChild(btn);
  });
}

function showPreview(index: number): void {
  if (previewPaths.length === 0) return;
  previewIndex = Math.max(0, Math.min(index, previewPaths.length - 1));
  const path = previewPaths[previewIndex]!;
  const img = $("fcs-preview-img") as HTMLImageElement;
  img.src = convertFileSrc(path);
  img.alt = basename(path);

  const label = $("fcs-preview-label");
  label.textContent = `${basename(path)} (${previewIndex + 1} / ${previewPaths.length})`;

  ($("fcs-preview-prev") as HTMLButtonElement).disabled = previewIndex === 0;
  ($("fcs-preview-next") as HTMLButtonElement).disabled =
    previewIndex >= previewPaths.length - 1;

  hostHighlightThumb();
}

function hostHighlightThumb(): void {
  const buttons = $("fcs-preview-thumbs").querySelectorAll(".fcs-preview-thumb");
  buttons.forEach((btn, i) => {
    btn.classList.toggle("is-active", i === previewIndex);
  });
}

function updatePlotsSummary(paths: string[]): void {
  const el = $("fcs-composites-summary") as HTMLElement;
  if (paths.length === 0) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  const folder = basename(lastPreviewDir);
  el.textContent = `${paths.length} diel plot(s) in ${folder}/ — use arrows or thumbnails to browse`;
}

function updateFolderButtons(hasPreviews: boolean): void {
  ($("fcs-open-ribbons") as HTMLButtonElement).disabled = !lastRibbonsDir;
  ($("fcs-open-plots") as HTMLButtonElement).disabled = !hasPreviews && !lastPlotsDir;
  ($("fcs-open-output") as HTMLButtonElement).disabled = !outputFolder && !segmentsFolder;
}

async function openFolder(dir: string): Promise<void> {
  if (!dir) return;
  try {
    await openPath(dir);
  } catch {
    setFcsStatus(`Folder: ${dir}`, "ok");
  }
}

async function copyBibtex(): Promise<void> {
  const text = ($("fcs-bibtex-ap") as HTMLElement).textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    setFcsStatus("BibTeX copied to clipboard.", "ok");
  } catch {
    setFcsStatus("Could not copy — select the BibTeX block manually.", "error");
  }
}

function appendLog(line: string): void {
  const log = $("fcs-log");
  log.textContent += line + "\n";
  log.scrollTop = log.scrollHeight;
}

function setFcsStatus(msg: string, kind: "" | "ok" | "error"): void {
  const el = $("fcs-status");
  el.textContent = msg;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

function setRunningUi(): void {
  const busy = computeRunning || postprocessRunning || installing;
  ($("fcs-run-compute") as HTMLButtonElement).disabled = busy;
  ($("fcs-run-postprocess") as HTMLButtonElement).disabled = busy;
  ($("fcs-cancel") as HTMLButtonElement).disabled = !computeRunning;
  ($("fcs-install") as HTMLButtonElement).disabled = busy;
}

function basename(path: string, stripExt = ""): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  if (stripExt && name.endsWith(stripExt)) return name.slice(0, -stripExt.length);
  return name;
}
