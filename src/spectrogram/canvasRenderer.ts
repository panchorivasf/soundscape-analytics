import { formatFreqAxisKhz } from "../freqUnits";
import { cmap, type CmapName } from "./colormap";
import { specDb, type BandInfo, type SpectrogramData } from "./compute";

export interface RenderOptions {
  cutoff: number;
  contrast: number;
  brightness: number;
  fMin: number;
  fMax: number;
  showCutoff: boolean;
  showBinary: boolean;
  diversityBands?: BandInfo[];
  fciBands?: BandInfo[];
  bbaiMask?: Uint8Array;
  /** When set (FADI), activity uses per-frequency-bin threshold instead of flat cutoff. */
  perBinThreshold?: Float32Array;
  thresholdLabel?: string;
  playheadSec?: number | null;
  cmap: CmapName;
}

const ADI_AEI_LINE = "rgba(160, 168, 178, 0.92)";
const BAND_EDGE_RED = "#e55353";
const AXIS_TICK = "rgba(154, 163, 178, 0.55)";

/** Default spectrogram display tuning (no UI sliders). */
export const SPEC_DISPLAY_CONTRAST = 88;
export const SPEC_DISPLAY_BRIGHTNESS = -12;

const FCI_LINE_COLORS: Record<string, string> = {
  LFC: "#023e8a",
  MFC: "#0077b6",
  HFC: "#00b4d8",
  UFC: "#90e0ef",
};

function displayDbRange(spec: SpectrogramData): [number, number] {
  const sorted = Float32Array.from(spec.logDb).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)] ?? spec.logMin;
  const hi = sorted[Math.floor(sorted.length * 0.98)] ?? spec.logMax;
  return [lo - 5, hi];
}

function colorizeDb(
  db: number,
  dbLo: number,
  dbHi: number,
  contrast: number,
  brightness: number,
  cmapName: CmapName
): [number, number, number] {
  const mid = (dbLo + dbHi) / 2 - brightness;
  const halfSpan = Math.max(1, (dbHi - dbLo) / 2) / Math.max(0.2, contrast / 60);
  const lo = mid - halfSpan;
  const hi = mid + halfSpan;
  const t = Math.max(0, Math.min(1, (db - lo) / Math.max(1e-6, hi - lo)));
  return cmap(t, cmapName);
}

export function renderSpectrogramCanvas(
  canvas: HTMLCanvasElement,
  spec: SpectrogramData,
  opts: RenderOptions
): void {
  const parent = canvas.parentElement;
  const w = Math.max(320, parent?.clientWidth ?? 800);
  const h = Math.max(280, parent?.clientHeight ?? 400);
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#0d1117";
  ctx.fillRect(0, 0, w, h);

  const margin = { l: 58, r: 12, t: 12, b: 28 };
  const pw = w - margin.l - margin.r;
  const ph = h - margin.t - margin.b;

  const [bLo, bHi] = freqBinRange(spec, opts.fMin, opts.fMax);
  const [dbLo, dbHi] = displayDbRange(spec);

  const img = ctx.createImageData(pw, ph);
  const px = img.data;

  for (let py = 0; py < ph; py++) {
    const bin =
      bLo + Math.round(((ph - 1 - py) / Math.max(1, ph - 1)) * (bHi - bLo));
    for (let pxX = 0; pxX < pw; pxX++) {
      const frame = Math.round((pxX / Math.max(1, pw - 1)) * (spec.frames - 1));
      const db = specDb(spec, bin, frame);
      const thr = opts.perBinThreshold ? opts.perBinThreshold[bin] : opts.cutoff;
      const active = db > thr;
      const i = (py * pw + pxX) * 4;

      if (opts.showBinary) {
        if (!active) {
          px[i] = 0;
          px[i + 1] = 0;
          px[i + 2] = 0;
        } else {
          px[i] = 255;
          px[i + 1] = 255;
          px[i + 2] = 255;
        }
        px[i + 3] = 255;
        continue;
      }

      if (opts.showCutoff && !active) {
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = 255;
        continue;
      }

      const [r, g, b] = colorizeDb(
        db,
        dbLo,
        dbHi,
        opts.contrast,
        opts.brightness,
        opts.cmap
      );
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;

      if (opts.bbaiMask && opts.bbaiMask[frame * spec.bins + bin]) {
        px[i] = 255;
        px[i + 1] = 70;
        px[i + 2] = 70;
      }
    }
  }

  ctx.putImageData(img, margin.l, margin.t);
  drawBandLines(ctx, spec, opts, margin, pw, ph, bLo, bHi);

  if (opts.playheadSec != null && spec.duration > 0) {
    const x = margin.l + (opts.playheadSec / spec.duration) * pw;
    ctx.strokeStyle = "rgba(255,255,100,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, margin.t);
    ctx.lineTo(x, margin.t + ph);
    ctx.stroke();
  }

  drawAxes(ctx, spec, opts, margin, pw, ph, dbLo, dbHi, bLo, bHi);
}

function freqBinRange(spec: SpectrogramData, fMin: number, fMax: number): [number, number] {
  let lo = 0;
  let hi = spec.bins - 1;
  for (let i = 0; i < spec.bins; i++) {
    if (spec.freqHz[i] >= fMin) {
      lo = i;
      break;
    }
  }
  for (let i = spec.bins - 1; i >= 0; i--) {
    if (spec.freqHz[i] <= fMax) {
      hi = i;
      break;
    }
  }
  return [lo, Math.max(lo, hi)];
}

function hzToY(
  hz: number,
  spec: SpectrogramData,
  bLo: number,
  bHi: number,
  margin: { t: number },
  ph: number
): number {
  let bin = bLo;
  let best = Infinity;
  for (let b = bLo; b <= bHi; b++) {
    const d = Math.abs(spec.freqHz[b] - hz);
    if (d < best) {
      best = d;
      bin = b;
    }
  }
  const frac = (bin - bLo) / Math.max(1, bHi - bLo);
  return margin.t + ph * (1 - frac);
}

function drawHorizGuideLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  x0: number,
  x1: number,
  color: string,
  dashed: boolean,
  width = 1.25
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

/** Gray upper-edge lines; band 1 low cut and last band top edge in red. */
function drawAdiAeiDividers(
  ctx: CanvasRenderingContext2D,
  bands: BandInfo[],
  spec: SpectrogramData,
  bLo: number,
  bHi: number,
  margin: { l: number; t: number },
  pw: number,
  ph: number
): void {
  const x0 = margin.l;
  const x1 = margin.l + pw;

  for (const band of bands) {
    const y = hzToY(band.maxHz, spec, bLo, bHi, margin, ph);
    drawHorizGuideLine(ctx, y, x0, x1, ADI_AEI_LINE, true);
  }

  if (bands.length > 0) {
    const yLo = hzToY(bands[0].minHz, spec, bLo, bHi, margin, ph);
    drawHorizGuideLine(ctx, yLo, x0, x1, BAND_EDGE_RED, true, 1.75);
    const yTop = hzToY(bands[bands.length - 1].maxHz, spec, bLo, bHi, margin, ph);
    drawHorizGuideLine(ctx, yTop, x0, x1, BAND_EDGE_RED, true, 1.75);
  }
}

/** FCI: colored upper-edge lines; LF low cut and UFC top in red. */
function drawFciDividers(
  ctx: CanvasRenderingContext2D,
  bands: BandInfo[],
  spec: SpectrogramData,
  bLo: number,
  bHi: number,
  margin: { l: number; t: number },
  pw: number,
  ph: number
): void {
  const x0 = margin.l;
  const x1 = margin.l + pw;

  ctx.setLineDash([6, 3]);
  for (const band of bands) {
    const y = hzToY(band.maxHz, spec, bLo, bHi, margin, ph);
    const color = FCI_LINE_COLORS[band.label] ?? "#90e0ef";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (bands.length > 0) {
    const yLo = hzToY(bands[0].minHz, spec, bLo, bHi, margin, ph);
    drawHorizGuideLine(ctx, yLo, x0, x1, BAND_EDGE_RED, true, 1.75);
    const yTop = hzToY(bands[bands.length - 1].maxHz, spec, bLo, bHi, margin, ph);
    drawHorizGuideLine(ctx, yTop, x0, x1, BAND_EDGE_RED, true, 1.75);
  }
}

function drawBandLines(
  ctx: CanvasRenderingContext2D,
  spec: SpectrogramData,
  opts: RenderOptions,
  margin: { l: number; t: number },
  pw: number,
  ph: number,
  bLo: number,
  bHi: number
): void {
  if (opts.diversityBands?.length) {
    drawAdiAeiDividers(ctx, opts.diversityBands, spec, bLo, bHi, margin, pw, ph);
  }
  if (opts.fciBands?.length) {
    drawFciDividers(ctx, opts.fciBands, spec, bLo, bHi, margin, pw, ph);
  }
}

function timeTickStepSec(duration: number): number {
  if (duration <= 30) return 2;
  if (duration <= 120) return 5;
  return 10;
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  spec: SpectrogramData,
  opts: RenderOptions,
  margin: { l: number; t: number; b: number },
  pw: number,
  ph: number,
  dbLo: number,
  dbHi: number,
  bLo: number,
  bHi: number
): void {
  ctx.fillStyle = "#9aa3b2";
  ctx.font = "10px Segoe UI, system-ui, sans-serif";
  ctx.strokeStyle = AXIS_TICK;
  ctx.lineWidth = 1;

  const freqStep = 2000;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  let fHz = Math.ceil(opts.fMin / freqStep) * freqStep;
  while (fHz <= opts.fMax + 1) {
    const y = hzToY(fHz, spec, bLo, bHi, margin, ph);
    ctx.beginPath();
    ctx.moveTo(margin.l - 3, y);
    ctx.lineTo(margin.l, y);
    ctx.stroke();
    ctx.fillText(formatFreqAxisKhz(fHz), margin.l - 5, y);
    fHz += freqStep;
  }

  const tStep = timeTickStepSec(spec.duration);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let t = 0; t <= spec.duration + 1e-6; t += tStep) {
    const x = margin.l + (t / spec.duration) * pw;
    ctx.beginPath();
    ctx.moveTo(x, margin.t + ph);
    ctx.lineTo(x, margin.t + ph + 3);
    ctx.stroke();
    const label = tStep < 1 ? `${t.toFixed(1)} s` : `${Math.round(t)} s`;
    ctx.fillText(label, x, margin.t + ph + 5);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const thrNote = opts.thresholdLabel ?? `cutoff ${opts.cutoff} dBFS`;
  ctx.fillText(
    `${dbLo.toFixed(0)}–${dbHi.toFixed(0)} dBFS  |  ${thrNote}`,
    margin.l,
    10
  );
}

export function renderBarChart(
  container: HTMLElement,
  items: { label: string; value: number; color?: string }[],
  opts?: { valueFormat?: "proportion" | "percent"; fractionDigits?: number }
): void {
  if (items.length === 0) {
    container.innerHTML = "";
    return;
  }
  const valueFormat = opts?.valueFormat;
  const fractionDigits = opts?.fractionDigits ?? (valueFormat === "proportion" ? 3 : 1);
  const fmtValue =
    valueFormat === "proportion"
      ? (v: number) => v.toFixed(fractionDigits)
      : (v: number) => `${(v * 100).toFixed(fractionDigits)}%`;
  container.innerHTML = items
    .map(
      (item) => `
    <div class="spec-bar-row">
      <span class="spec-bar-label">${item.label}</span>
      <div class="spec-bar-track"><div class="spec-bar-fill" style="width:${Math.min(100, item.value * 100).toFixed(1)}%;background:${item.color ?? "#2a9d8f"}"></div></div>
      <span class="spec-bar-pct">${fmtValue(item.value)}</span>
    </div>`
    )
    .join("");
}
