import { hzToKhzInput, khzInputToHz } from "./freqUnits";
import type { BandRange } from "./types";

const MAX_DIV_BANDS = 20;

const DEFAULT_BAND_LOW_CUT_HZ = 200;
const DEFAULT_BAND_STEP_HZ = 1000;
const DEFAULT_BAND_TOP_HZ = 10_000;

/** Default ADI/AEI/FADI bands: low cut then 1 kHz steps (0.2, 1, 2, 3 … kHz). */
export function standardDivBands(n: number, lowCutHz: number = DEFAULT_BAND_LOW_CUT_HZ): BandRange[] {
  const count = Math.max(1, Math.min(MAX_DIV_BANDS, Math.round(n)));
  return Array.from({ length: count }, (_, i) => ({
    minHz: i === 0 ? lowCutHz : i * DEFAULT_BAND_STEP_HZ,
    maxHz: (i + 1) * DEFAULT_BAND_STEP_HZ,
  }));
}

export function equalDivBands(n: number, lowCutHz: number, topHz: number): BandRange[] {
  const count = Math.max(1, Math.min(MAX_DIV_BANDS, Math.round(n)));
  const width = (topHz - lowCutHz) / count;
  return Array.from({ length: count }, (_, j) => ({
    minHz: lowCutHz + j * width,
    maxHz: lowCutHz + (j + 1) * width,
  }));
}

export function divBandRangeFromBands(bands: BandRange[]): { minHz: number; maxHz: number } {
  if (bands.length === 0) return { minHz: DEFAULT_BAND_LOW_CUT_HZ, maxHz: DEFAULT_BAND_TOP_HZ };
  return {
    minHz: bands[0].minHz,
    maxHz: bands[bands.length - 1].maxHz,
  };
}

function gridId(prefix: string): string {
  return prefix ? `${prefix}div-bands-grid` : "div-bands-grid";
}

function bandMinInputId(prefix: string): string {
  return `${prefix}div-band-low-cut`;
}

function bandMaxInputId(prefix: string, index: number): string {
  return `${prefix}div-band-${index}-max`;
}

export function renderDivBandGrid(prefix: string, bands: BandRange[]): void {
  const container = document.getElementById(gridId(prefix));
  if (!container) return;

  const rows: string[] = [
    `<label>Band 1 low cut (kHz)
      <input id="${bandMinInputId(prefix)}" class="spec-param div-band-input" type="number" step="0.1" min="0" value="${hzToKhzInput(bands[0]?.minHz ?? DEFAULT_BAND_LOW_CUT_HZ)}" title="Band-pass lower edge for band 1" />
    </label>`,
  ];

  bands.forEach((b, i) => {
    rows.push(
      `<label>Band ${i + 1} upper (kHz)
        <input id="${bandMaxInputId(prefix, i)}" class="spec-param div-band-input" type="number" step="0.1" min="0" value="${hzToKhzInput(b.maxHz)}" data-band="${i}" />
      </label>`
    );
  });

  container.innerHTML = rows.join("");
}

export function readDivBands(prefix: string, nBands: number): BandRange[] {
  const count = Math.max(1, Math.min(MAX_DIV_BANDS, Math.round(nBands)));
  const lowCutEl = document.getElementById(bandMinInputId(prefix)) as HTMLInputElement | null;
  const lowCut = lowCutEl ? khzInputToHz(Number(lowCutEl.value)) : DEFAULT_BAND_LOW_CUT_HZ;

  const bands: BandRange[] = [];
  let prevMax = lowCut;

  for (let i = 0; i < count; i++) {
    const maxEl = document.getElementById(bandMaxInputId(prefix, i)) as HTMLInputElement | null;
    const maxHz = maxEl ? khzInputToHz(Number(maxEl.value)) : prevMax + 1000;
    const minHz = i === 0 ? lowCut : prevMax;
    bands.push({ minHz, maxHz: Math.max(minHz + 1, maxHz) });
    prevMax = bands[i].maxHz;
  }

  if (bands.length > 0) return bands;
  return standardDivBands(count, DEFAULT_BAND_LOW_CUT_HZ);
}

export function applyDivBandsToDom(prefix: string, bands: BandRange[]): void {
  renderDivBandGrid(prefix, bands);
}

export function syncDivBandGrids(fromPrefix: string, toPrefix: string, nBands: number): void {
  const bands = readDivBands(fromPrefix, nBands);
  applyDivBandsToDom(toPrefix, bands);
}

export function initDivBandEditors(prefix: string): void {
  const nBandsId = `${prefix}n-bands`;
  const equalizeId = `${prefix}div-bands-equalize`;
  const nEl = document.getElementById(nBandsId) as HTMLInputElement | null;
  const eqBtn = document.getElementById(equalizeId);

  const currentRange = (): { minHz: number; maxHz: number } => {
    const existing = readDivBands(prefix, Number(nEl?.value ?? 10));
    return divBandRangeFromBands(existing);
  };

  const rebuildEqual = () => {
    const n = Number(nEl?.value ?? 10);
    const { minHz, maxHz } = currentRange();
    renderDivBandGrid(prefix, equalDivBands(n, minHz, maxHz));
  };

  nEl?.addEventListener("change", rebuildEqual);
  eqBtn?.addEventListener("click", rebuildEqual);
}

export function getDiversityBands(params: {
  divBandRanges: BandRange[];
  nBands: number;
  minFreq: number;
  maxFreq: number | null;
}): BandRange[] {
  if (params.divBandRanges.length > 0) {
    return params.divBandRanges.slice(0, Math.max(1, params.nBands));
  }
  return standardDivBands(params.nBands, params.minFreq || DEFAULT_BAND_LOW_CUT_HZ);
}

export function formatDivBandLabel(minHz: number, maxHz: number): string {
  const lo = minHz / 1000;
  const hi = maxHz / 1000;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));
  return `${fmt(lo)}–${fmt(hi)} kHz`;
}
