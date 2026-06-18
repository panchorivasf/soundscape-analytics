import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { isAudioFile } from "./audioFormats";
import { readViewFreqRange, syncParamForms } from "./paramsForm";
import type { IndexParams } from "./types";
import {
  adiCalcBreakdown,
  aeiCalcBreakdown,
  bbaiClickMask,
  computeSpectrogram,
  defaultFftSize,
  diversityBandProportions,
  proportionsHint,
  fadiCalcBreakdown,
  fadiBandStats,
  fadiPerBinThreshold,
  fciBandStats,
  type BandInfo,
  type SpectrogramData,
} from "./spectrogram/compute";
import { SPEC_DISPLAY_BRIGHTNESS, SPEC_DISPLAY_CONTRAST, renderBarChart, renderSpectrogramCanvas } from "./spectrogram/canvasRenderer";
import { loadWav, resolveChannelSamples } from "./spectrogram/wavLoader";
import { nextPow2 } from "./spectrogram/fft";

export type VizIndex = "" | "adi-aei" | "fadi" | "fci" | "bbai";

type VizMode = "regular" | "cutoff" | "binary";

const PARAM_DEBOUNCE_MS = 2000;
const DISPLAY_DEBOUNCE_MS = 120;

interface ViewerDeps {
  getFiles: () => string[];
  readParams: () => IndexParams;
  getIndices: () => string[];
}

interface ChannelSpec {
  spec: SpectrogramData;
  diversityBands: BandInfo[];
  fadiBands: BandInfo[];
  fadiThreshold: Float32Array | null;
  fciBands: BandInfo[];
  bbaiMask: Uint8Array | null;
  bbaiValue: number;
}

interface ViewerState {
  filePath: string;
  fileName: string;
  stereoEach: boolean;
  primary: ChannelSpec;
  secondary: ChannelSpec | null;
}

let deps: ViewerDeps | null = null;
let state: ViewerState | null = null;
let paramDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let displayDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let reloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let playheadRaf = 0;
let pendingPlayhead: number | null = null;
let statusBase = "";

function selectedVizIndex(): VizIndex {
  const v = (document.getElementById("spec-viz-index") as HTMLSelectElement | null)?.value ?? "";
  if (v === "adi-aei" || v === "fadi" || v === "fci" || v === "bbai") return v;
  return "";
}

function setPendingHint(active: boolean): void {
  const status = document.getElementById("spec-status");
  if (!status) return;
  const hint = status.querySelector(".spec-pending-hint");
  if (active && !hint) {
    status.insertAdjacentHTML("beforeend", ' <span class="spec-pending-hint">Updating…</span>');
  } else if (!active && hint) {
    hint.remove();
  }
}

function scheduleParamRender(): void {
  setPendingHint(true);
  if (paramDebounceTimer) clearTimeout(paramDebounceTimer);
  paramDebounceTimer = setTimeout(() => {
    paramDebounceTimer = null;
    setPendingHint(false);
    renderAll();
  }, PARAM_DEBOUNCE_MS);
}

function scheduleDisplayRender(): void {
  if (displayDebounceTimer) clearTimeout(displayDebounceTimer);
  displayDebounceTimer = setTimeout(() => {
    displayDebounceTimer = null;
    renderAll();
  }, DISPLAY_DEBOUNCE_MS);
}

function scheduleReload(): void {
  setPendingHint(true);
  if (reloadDebounceTimer) clearTimeout(reloadDebounceTimer);
  reloadDebounceTimer = setTimeout(() => {
    reloadDebounceTimer = null;
    void loadSpectrogram();
  }, PARAM_DEBOUNCE_MS);
}

function flushPendingRender(): void {
  if (paramDebounceTimer) {
    clearTimeout(paramDebounceTimer);
    paramDebounceTimer = null;
  }
  if (displayDebounceTimer) {
    clearTimeout(displayDebounceTimer);
    displayDebounceTimer = null;
  }
  setPendingHint(false);
}

function updateSandboxParamPanels(): void {
  const idx = selectedVizIndex();
  document.querySelectorAll<HTMLElement>(".sb-index-params").forEach((el) => {
    const allowed = (el.dataset.sbIndex ?? "").split(/\s+/).filter(Boolean);
    el.hidden = idx === "" || !allowed.includes(idx);
  });
  const hint = document.getElementById("spec-mask-hint");
  if (hint) {
    hint.textContent =
      idx === "fadi"
        ? "FADI: cutoff/binary overlays use the per-bin floating threshold (histogram noise + γ), not the flat dBFS cutoff."
        : idx === "adi-aei" || idx === "fci" || idx === "bbai"
          ? "Cutoff/binary overlays use the flat dBFS cutoff parameter."
          : "Choose an index to configure parameters and overlays.";
  }
}

function updatePlotLayout(stereoEach: boolean): void {
  const single = document.getElementById("spec-plot-single");
  const dual = document.getElementById("spec-plot-dual");
  if (single) single.hidden = stereoEach;
  if (dual) dual.hidden = !stereoEach;
}

function showDualSpectrograms(v: ViewerState): boolean {
  return v.stereoEach && v.secondary != null && deps?.readParams().channelMode === "each";
}

export function initSpectrogramViewer(viewerDeps: ViewerDeps): void {
  deps = viewerDeps;
  document.getElementById("spec-load")?.addEventListener("click", () => {
    flushPendingRender();
    void loadSpectrogram();
  });
  document.getElementById("sb-sync-analyze")?.addEventListener("click", () => {
    syncParamForms("", "sb-");
    flushPendingRender();
    if (state) renderAll();
  });

  const vizSelect = document.getElementById("spec-viz-index");
  vizSelect?.addEventListener("change", () => {
    updateSandboxParamPanels();
    scheduleDisplayRender();
  });
  updateSandboxParamPanels();
  updatePlotLayout(false);

  document.getElementById("tab-sandbox")?.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains("spec-viz-mode")) {
      handleVizModeToggle(t);
      scheduleDisplayRender();
      return;
    }
  });

  document.getElementById("tab-sandbox")?.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches(".spec-reload")) {
      if ((t as HTMLSelectElement).id === "sb-channel-mode" && (t as HTMLSelectElement).value !== "each") {
        updatePlotLayout(false);
      }
      scheduleReload();
    } else if (t.matches(".spec-param, .div-band-input, .fci-band-input")) {
      scheduleParamRender();
    } else if (t.matches(".spec-view-ctrl, .spec-viz-mode")) {
      scheduleDisplayRender();
    }
  });

  document.getElementById("tab-sandbox")?.addEventListener("change", (e) => {
    const t = e.target as HTMLElement;
    if (t.matches(".spec-reload")) {
      if ((t as HTMLSelectElement).id === "sb-channel-mode" && (t as HTMLSelectElement).value !== "each") {
        updatePlotLayout(false);
      }
      scheduleReload();
    } else if (t.matches(".spec-param, .div-band-input, .fci-band-input")) {
      scheduleParamRender();
    } else if (t.matches(".spec-view-ctrl, .spec-viz-mode")) {
      scheduleDisplayRender();
    }
  });

  const audio = document.getElementById("spec-audio") as HTMLAudioElement | null;
  audio?.addEventListener("timeupdate", () => {
    if (!state) return;
    pendingPlayhead = audio.currentTime;
    if (!playheadRaf) {
      playheadRaf = requestAnimationFrame(() => {
        playheadRaf = 0;
        if (state && pendingPlayhead != null) {
          renderCanvas(state, pendingPlayhead);
        }
      });
    }
  });

  window.addEventListener("resize", () => {
    if (state) scheduleDisplayRender();
  });
}

export async function refreshSpectrogramFiles(): Promise<void> {
  const sel = document.getElementById("spec-file") as HTMLSelectElement;
  if (!sel || !deps) return;
  const prev = sel.value;

  const files: string[] = [];
  for (const f of deps.getFiles()) {
    if (isAudioFile(f)) {
      files.push(f);
    } else {
      try {
        const listed = await invoke<string[]>("list_wav_in_folder", { folder: f });
        files.push(...listed);
      } catch {
        /* ignore */
      }
    }
  }

  sel.innerHTML =
    files.length === 0
      ? '<option value="">— select audio files in File menu —</option>'
      : files
          .map((f) => {
            const name = f.split(/[/\\]/).pop() ?? f;
            return `<option value="${escapeAttr(f)}">${name}</option>`;
          })
          .join("");
  if (prev && files.includes(prev)) sel.value = prev;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function overlayChecked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement)?.checked ?? false;
}

function vizMode(): VizMode {
  if (overlayChecked("spec-show-binary")) return "binary";
  if (overlayChecked("spec-show-cutoff")) return "cutoff";
  return "regular";
}

function setVizMode(mode: VizMode): void {
  const regular = document.getElementById("spec-show-regular") as HTMLInputElement | null;
  const cutoff = document.getElementById("spec-show-cutoff") as HTMLInputElement | null;
  const binary = document.getElementById("spec-show-binary") as HTMLInputElement | null;
  if (regular) regular.checked = mode === "regular";
  if (cutoff) cutoff.checked = mode === "cutoff";
  if (binary) binary.checked = mode === "binary";
}

function handleVizModeToggle(changed: HTMLInputElement): void {
  if (changed.checked) {
    if (changed.id === "spec-show-regular") setVizMode("regular");
    else if (changed.id === "spec-show-cutoff") setVizMode("cutoff");
    else if (changed.id === "spec-show-binary") setVizMode("binary");
    return;
  }
  // Keep at least one mode selected — fall back to regular if all unchecked
  if (!overlayChecked("spec-show-regular") && !overlayChecked("spec-show-cutoff") && !overlayChecked("spec-show-binary")) {
    setVizMode("regular");
  }
}

function recomputeChannelStats(
  spec: SpectrogramData,
  params: IndexParams,
  idx: VizIndex
): Omit<ChannelSpec, "spec"> {
  const out: Omit<ChannelSpec, "spec"> = {
    diversityBands: [],
    fadiBands: [],
    fadiThreshold: null,
    fciBands: [],
    bbaiMask: null,
    bbaiValue: 0,
  };

  if (idx === "adi-aei" || idx === "fadi") {
    out.diversityBands = diversityBandProportions(spec, params);
  }
  if (idx === "fadi") {
    out.fadiThreshold = fadiPerBinThreshold(spec, params);
    out.fadiBands = fadiBandStats(spec, params);
  }
  if (idx === "fci") {
    out.fciBands = fciBandStats(spec, params);
  }
  if (idx === "bbai") {
    const bb = bbaiClickMask(spec, params);
    out.bbaiMask = bb.mask;
    out.bbaiValue = bb.value;
  }
  return out;
}

function buildChannelSpec(
  spec: SpectrogramData,
  params: IndexParams,
  idx: VizIndex
): ChannelSpec {
  return { spec, ...recomputeChannelStats(spec, params, idx) };
}

function refreshChannelStats(v: ViewerState, params: IndexParams, idx: VizIndex): void {
  Object.assign(v.primary, recomputeChannelStats(v.primary.spec, params, idx));
  if (v.secondary) {
    Object.assign(v.secondary, recomputeChannelStats(v.secondary.spec, params, idx));
  }
}

async function loadSpectrogram(): Promise<void> {
  const sel = document.getElementById("spec-file") as HTMLSelectElement;
  const status = document.getElementById("spec-status");
  if (!deps || !sel.value) {
    if (status) status.textContent = "Select a WAV file first.";
    return;
  }

  const params = deps.readParams();
  const idx = selectedVizIndex();
  if (status) status.textContent = "Loading audio…";
  const t0 = performance.now();

  try {
    const wav = await loadWav(sel.value);
    const { primary, secondary, stereoEach } = resolveChannelSamples(wav, params.channelMode);
    updatePlotLayout(stereoEach);

    const fftEl = document.getElementById("spec-fft") as HTMLInputElement | null;
    const fftDefault = defaultFftSize(wav.sampleRate);
    if (fftEl && fftEl.value.trim() === "") {
      fftEl.placeholder = String(fftDefault);
    }
    const fftRaw = fftEl?.value.trim() ? Number(fftEl.value) : fftDefault;
    const fftN = nextPow2(Math.max(64, Math.min(4096, fftRaw)));

    if (status) status.textContent = "Computing spectrogram…";
    const specPrimary = computeSpectrogram(primary, wav.sampleRate, fftN);
    const specSecondary = secondary
      ? computeSpectrogram(secondary, wav.sampleRate, fftN)
      : null;

    const fileName = sel.value.split(/[/\\]/).pop() ?? sel.value;
    state = {
      filePath: sel.value,
      fileName,
      stereoEach,
      primary: buildChannelSpec(specPrimary, params, idx),
      secondary: specSecondary ? buildChannelSpec(specSecondary, params, idx) : null,
    };

    setupAudio(sel.value);
    setPendingHint(false);
    renderAll();

    const ms = (performance.now() - t0).toFixed(0);
    const chNote = stereoEach ? " · stereo (L/R)" : "";
    statusBase = `${fileName} — ${wav.duration.toFixed(1)}s @ ${wav.sampleRate} Hz — ${specPrimary.frames}×${specPrimary.bins} in ${ms}ms${chNote}`;
    if (status) status.textContent = statusBase;
  } catch (e) {
    if (status) status.textContent = String(e);
    state = null;
  }
}

function setupAudio(filePath: string): void {
  const audio = document.getElementById("spec-audio") as HTMLAudioElement;
  if (!audio) return;
  audio.src = convertFileSrc(filePath);
  audio.load();
}

function renderAll(): void {
  if (!state || !deps) return;
  const params = deps.readParams();
  const idx = selectedVizIndex();
  refreshChannelStats(state, params, idx);
  updatePlotLayout(showDualSpectrograms(state));

  const audio = document.getElementById("spec-audio") as HTMLAudioElement | null;
  renderCanvas(state, audio?.currentTime ?? null);
  renderStats(state, idx, params);
  renderIndexCalcs(state, idx, params);
  updateProportionsDesc(params.propDen === 1 ? 1 : 2);
}

function fmtPct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function fmtNum(n: number, digits = 4): string {
  return n.toFixed(digits);
}

function fmtProp(n: number): string {
  return n.toFixed(3);
}

function renderAdiCalcPane(bands: BandInfo[], channelLabel?: string, propDen = 2): string {
  const { terms, adi } = adiCalcBreakdown(bands);
  if (terms.length === 0) {
    return `<h3>ADI${channelLabel ? ` (${channelLabel})` : ""}</h3><p class="spec-hint">No active cells above threshold.</p>`;
  }
  const normNote =
    propDen === 1
      ? " (band values normalized to sum to 1 before Shannon step)"
      : "";
  const lines = [...terms].reverse().map(
    (t) =>
      `  ${t.label}: p = ${fmtProp(t.p)}  →  −p·ln(p) = ${fmtNum(t.contribution)}`
  );
  return (
    `<h3>ADI${channelLabel ? ` (${channelLabel})` : ""} ≈ ${fmtNum(adi, 3)}</h3>` +
    `<p class="spec-hint">Acoustic Diversity Index (Shannon entropy${normNote})</p>` +
    `<pre class="spec-calc-formula">ADI = − Σ pᵢ ln(pᵢ)

${lines.join("\n")}
─────────────────────────
ADI ≈ ${fmtNum(adi, 3)}</pre>`
  );
}

function renderAeiCalcPane(bands: BandInfo[], channelLabel?: string): string {
  const { terms, weighted, sum, aei } = aeiCalcBreakdown(bands);
  if (terms.length === 0) {
    return `<h3>AEI${channelLabel ? ` (${channelLabel})` : ""}</h3><p class="spec-hint">No active cells above threshold.</p>`;
  }
  const n = terms.length;
  const lines = terms.map(
    (t) => `  rank ${t.rank}: ${t.label}, x = ${fmtNum(t.x, 4)}  →  ${t.rank}·x = ${fmtNum(t.rank * t.x)}`
  );
  return (
    `<h3>AEI${channelLabel ? ` (${channelLabel})` : ""} ≈ ${fmtNum(aei, 3)}</h3>` +
    `<p class="spec-hint">Acoustic Evenness Index (Gini coefficient on proportions + ε)</p>` +
    `<pre class="spec-calc-formula">AEI = (2 Σ i·xᵢ) / (n Σ xᵢ) − (n+1)/n    (x sorted ascending)

${lines.join("\n")}
─────────────────────────
Σ i·xᵢ = ${fmtNum(weighted)}   n = ${n}   Σ xᵢ = ${fmtNum(sum)}
AEI ≈ ${fmtNum(aei, 3)}</pre>`
  );
}

function renderFadiCalcPane(
  ch: ChannelSpec,
  params: IndexParams,
  channelLabel?: string
): string {
  const { terms, sumZ, fadi } = fadiCalcBreakdown(ch.spec, params);
  if (terms.length === 0 || sumZ === 0) {
    return `<h3>FADI${channelLabel ? ` (${channelLabel})` : ""}</h3><p class="spec-hint">No cells above the floating threshold.</p>`;
  }
  const rawLines = terms.map(
    (t) => `  ${t.label}: z = ${fmtPct(t.z)}  (cells above T(f) / total in band)`
  );
  const normLines = terms.map(
    (t) =>
      `  ${t.label}: p = z/Σz = ${fmtNum(t.p, 4)}  →  −p·ln(p+ε) = ${fmtNum(t.contribution)}`
  );
  return (
    `<h3>FADI${channelLabel ? ` (${channelLabel})` : ""} ≈ ${fmtNum(fadi, 6)}</h3>` +
    `<p class="spec-hint">Frequency-dependent ADI — Shannon entropy of band scores using per-bin floating threshold (histogram noise + γ, floored by global offset)</p>` +
    `<pre class="spec-calc-formula">1) Within-band score (floating threshold T(f) per frequency bin):
${rawLines.join("\n")}
   Σ z = ${fmtNum(sumZ, 4)}

2) Normalize:  pᵢ = zᵢ / Σ zⱼ

3) FADI = − Σ pᵢ ln(pᵢ + ε)    ε = 10⁻⁷

${normLines.join("\n")}
─────────────────────────
FADI ≈ ${fmtNum(fadi, 6)}</pre>`
  );
}

function updateProportionsDesc(propDen: number): void {
  const el = document.getElementById("sb-proportions-desc");
  if (el) el.textContent = proportionsHint(propDen);
}

export function syncProportionsDescFromParams(): void {
  if (!deps) return;
  try {
    const propDen = deps.readParams().propDen === 1 ? 1 : 2;
    updateProportionsDesc(propDen);
  } catch {
    updateProportionsDesc(2);
  }
}

function renderIndexCalcs(v: ViewerState, idx: VizIndex, params: IndexParams): void {
  const row = document.getElementById("spec-index-calcs");
  const adiPane = document.getElementById("spec-adi-calc");
  const aeiPane = document.getElementById("spec-aei-calc");
  const fadiPane = document.getElementById("spec-fadi-calc");
  if (!row || !adiPane || !aeiPane || !fadiPane || !deps) return;

  row.classList.remove("mode-fadi");
  adiPane.hidden = false;
  aeiPane.hidden = false;
  fadiPane.hidden = true;
  adiPane.innerHTML = "";
  aeiPane.innerHTML = "";
  fadiPane.innerHTML = "";

  if (idx === "adi-aei" && v.primary.diversityBands.length) {
    row.hidden = false;
    const propDen = params.propDen === 1 ? 1 : 2;
    if (showDualSpectrograms(v) && v.secondary) {
      adiPane.innerHTML =
        renderAdiCalcPane(v.primary.diversityBands, "Left", propDen) +
        `<hr class="spec-calc-sep" />` +
        renderAdiCalcPane(v.secondary.diversityBands, "Right", propDen);
      aeiPane.innerHTML =
        renderAeiCalcPane(v.primary.diversityBands, "Left") +
        `<hr class="spec-calc-sep" />` +
        renderAeiCalcPane(v.secondary.diversityBands, "Right");
    } else {
      adiPane.innerHTML = renderAdiCalcPane(v.primary.diversityBands, undefined, propDen);
      aeiPane.innerHTML = renderAeiCalcPane(v.primary.diversityBands);
    }
    return;
  }

  if (idx === "fadi" && v.primary.fadiBands.length) {
    row.hidden = false;
    row.classList.add("mode-fadi");
    adiPane.hidden = true;
    aeiPane.hidden = true;
    fadiPane.hidden = false;
    const params = deps.readParams();
    if (showDualSpectrograms(v) && v.secondary) {
      fadiPane.innerHTML =
        renderFadiCalcPane(v.primary, params, "Left") +
        `<hr class="spec-calc-sep" />` +
        renderFadiCalcPane(v.secondary, params, "Right");
    } else {
      fadiPane.innerHTML = renderFadiCalcPane(v.primary, params);
    }
    return;
  }

  row.hidden = true;
}

function renderOptionsForChannel(
  ch: ChannelSpec,
  params: IndexParams,
  idx: VizIndex,
  playheadSec: number | null
) {
  const nyquist = ch.spec.sampleRate / 2;
  const { fMin, fMax } = readViewFreqRange(nyquist);
  const isFadi = idx === "fadi";
  const mode = vizMode();
  const showMask = mode === "cutoff" || mode === "binary";

  return {
    cutoff: params.cutoff,
    contrast: SPEC_DISPLAY_CONTRAST,
    brightness: SPEC_DISPLAY_BRIGHTNESS,
    fMin,
    fMax,
    showCutoff: mode === "cutoff",
    showBinary: mode === "binary",
    diversityBands: idx === "adi-aei" || idx === "fadi" ? ch.diversityBands : undefined,
    fciBands: idx === "fci" ? ch.fciBands : undefined,
    bbaiMask: idx === "bbai" ? ch.bbaiMask ?? undefined : undefined,
    perBinThreshold: isFadi && showMask ? ch.fadiThreshold ?? undefined : undefined,
    thresholdLabel: isFadi && showMask ? "FADI per-bin threshold" : undefined,
    playheadSec,
    cmap:
      (document.getElementById("spec-cmap") as HTMLSelectElement)?.value === "inferno"
        ? "inferno"
        : "viridis",
  } as const;
}

function renderCanvas(v: ViewerState, playheadSec: number | null): void {
  if (!deps) return;
  const params = deps.readParams();
  const idx = selectedVizIndex();

  if (showDualSpectrograms(v) && v.secondary) {
    const canvasL = document.getElementById("spec-canvas-l") as HTMLCanvasElement | null;
    const canvasR = document.getElementById("spec-canvas-r") as HTMLCanvasElement | null;
    if (canvasL) {
      renderSpectrogramCanvas(canvasL, v.primary.spec, renderOptionsForChannel(v.primary, params, idx, playheadSec));
    }
    if (canvasR) {
      renderSpectrogramCanvas(canvasR, v.secondary.spec, renderOptionsForChannel(v.secondary, params, idx, playheadSec));
    }
  } else {
    const canvas = document.getElementById("spec-canvas") as HTMLCanvasElement | null;
    if (canvas) {
      renderSpectrogramCanvas(canvas, v.primary.spec, renderOptionsForChannel(v.primary, params, idx, playheadSec));
    }
  }
}

function renderStats(v: ViewerState, idx: VizIndex, params: IndexParams): void {
  const panel = document.getElementById("spec-stats");
  const bars = document.getElementById("spec-props-bars");
  if (!panel) return;

  const propHint = proportionsHint(params.propDen === 1 ? 1 : 2);
  const sections: string[] = [];
  const barItems: { label: string; value: number; color?: string }[] = [];

  const appendChannelStats = (label: string, ch: ChannelSpec) => {
    if (idx === "adi-aei" && ch.diversityBands.length) {
      pushBandBars(barItems, ch.diversityBands, label);
    }
    if (idx === "fadi" && ch.fadiBands.length) {
      sections.push(`<div class="spec-stat-block"><h3>${label} — FADI bands</h3></div>`);
      pushBandBars(barItems, ch.fadiBands, label, "#c678dd");
    }
    if (idx === "fci" && ch.fciBands.length) {
      sections.push(`<div class="spec-stat-block"><h3>${label} — FCI cover</h3></div>`);
      pushBandBars(barItems, ch.fciBands, label, "#6495ed");
    }
    if (idx === "bbai") {
      sections.push(
        `<div class="spec-stat-block"><h3>${label} — BBAI ≈ ${ch.bbaiValue.toFixed(2)}</h3></div>`
      );
    }
  };

  if (showDualSpectrograms(v) && v.secondary) {
    if (idx === "adi-aei" && v.primary.diversityBands.length) {
      sections.push(
        `<div class="spec-stat-block"><h3>Band proportions</h3>` +
          `<p class="spec-hint">${propHint}</p></div>`
      );
    }
    appendChannelStats("Left", v.primary);
    appendChannelStats("Right", v.secondary);
    if (idx === "bbai") {
      sections.push(`<p class="spec-hint">Red cells = broad-band click detections.</p>`);
    }
  } else {
    if (idx === "adi-aei" && v.primary.diversityBands.length) {
      sections.push(
        `<div class="spec-stat-block"><h3>Band proportions</h3>` +
          `<p class="spec-hint">${propHint}</p></div>`
      );
      pushBandBars(barItems, v.primary.diversityBands);
    }
    if (idx === "fadi" && v.primary.fadiBands.length) {
      sections.push(
        `<div class="spec-stat-block"><h3>FADI band scores</h3>` +
          `<p class="spec-hint">Within-band activity above the floating threshold (histogram noise + γ), normalized across bands.</p></div>`
      );
      pushBandBars(barItems, v.primary.fadiBands, undefined, "#c678dd");
    }
    if (idx === "fci" && v.primary.fciBands.length) {
      sections.push(`<div class="spec-stat-block"><h3>FCI cover</h3></div>`);
      pushBandBars(barItems, v.primary.fciBands, undefined, "#6495ed");
    }
    if (idx === "bbai") {
      sections.push(
        `<div class="spec-stat-block"><h3>BBAI ≈ ${v.primary.bbaiValue.toFixed(2)}</h3><p class="spec-hint">Red cells = broad-band click detections.</p></div>`
      );
    }
  }

  panel.innerHTML =
    idx && sections.length > 0
      ? sections.join("")
      : idx
        ? '<p class="spec-hint">Load a file to see index statistics.</p>'
        : '<p class="spec-hint">Choose an index above to visualize parameters and statistics.</p>';

  if (bars) {
    const barOpts =
      idx === "adi-aei" && barItems.length > 0
        ? { valueFormat: "proportion" as const, fractionDigits: 3 }
        : idx === "fci" && barItems.length > 0
          ? { valueFormat: "percent" as const, fractionDigits: 3 }
          : undefined;
    renderBarChart(bars, barItems, barOpts);
  }
}

function pushBandBars(
  items: { label: string; value: number; color?: string }[],
  bands: BandInfo[],
  prefix?: string,
  color = "#8b949e"
): void {
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    const label = prefix ? `${prefix} ${b.label}` : b.label;
    items.push({ label, value: b.value, color });
  }
}
