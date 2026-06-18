import type { IndexParams } from "../types";
import { standardDivBands } from "../divBands";
import { fft, hannWin, nextPow2 } from "./fft";

/** Full-scale reference for float WAV decoded in the browser (matches Rust SampleScale::Float). */
const AMP_MAX = 1.0;

export interface SpectrogramData {
  frames: number;
  bins: number;
  hop: number;
  fftN: number;
  sampleRate: number;
  duration: number;
  /** dBFS per cell (20·log10 amplitude / full scale), frame-major. */
  logDb: Float32Array;
  freqHz: Float32Array;
  logMin: number;
  logMax: number;
}

export function defaultFftSize(sampleRate: number): number {
  const target = Math.round((sampleRate * 2048) / 48_000);
  return nextPow2(Math.max(64, Math.min(4096, target)));
}

export function fftSizeFromParams(sampleRate: number, params: IndexParams): number {
  const target = Math.max(64, Math.round(sampleRate / params.freqRes));
  return Math.min(4096, nextPow2(target));
}

export function computeSpectrogram(
  rawSamples: Float32Array,
  sampleRate: number,
  fftNIn: number,
  hop?: number
): SpectrogramData {
  const fftN = nextPow2(Math.max(64, Math.min(4096, fftNIn)));
  const hopSize = hop ?? Math.max(1, fftN >> 2);
  const n = rawSamples.length;
  const nFrames = Math.max(1, Math.floor((n - fftN) / hopSize) + 1);
  const nBins = fftN >> 1;
  const logDb = new Float32Array(nFrames * nBins);
  const win = hannWin(fftN);
  const ampCorrection = 2 / fftN;
  const re = new Float32Array(fftN);
  const im = new Float32Array(fftN);

  let minDb = Infinity;
  let maxDb = -Infinity;

  for (let fr = 0; fr < nFrames; fr++) {
    const off = fr * hopSize;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftN && off + i < n; i++) {
      re[i] = rawSamples[off + i] * win[i];
    }
    fft(re, im, fftN);
    const base = fr * nBins;
    for (let b = 0; b < nBins; b++) {
      const mag = Math.hypot(re[b], im[b]) * ampCorrection;
      const dbfs = 20 * Math.log10(Math.max(mag / AMP_MAX, 1e-30));
      logDb[base + b] = dbfs;
      if (dbfs < minDb) minDb = dbfs;
      if (dbfs > maxDb) maxDb = dbfs;
    }
  }

  const freqHz = new Float32Array(nBins);
  for (let b = 0; b < nBins; b++) {
    freqHz[b] = (b * sampleRate) / fftN;
  }

  return {
    frames: nFrames,
    bins: nBins,
    hop: hopSize,
    fftN,
    sampleRate,
    duration: n / sampleRate,
    logDb,
    freqHz,
    logMin: minDb,
    logMax: maxDb,
  };
}

/** Sample cell: frame-major indexing */
export function specDb(spec: SpectrogramData, bin: number, frame: number): number {
  return spec.logDb[frame * spec.bins + bin];
}

/** Equal-width frequency bands for ADI/AEI/FADI from explicit div_band_ranges. */
export function getEqualHzBands(params: IndexParams, _sampleRate: number) {
  const bands = params.divBandRanges?.length
    ? params.divBandRanges.slice(0, Math.max(1, params.nBands))
    : null;
  if (bands && bands.length > 0) {
    return bands.map((b) => ({
      label: formatKhzBandLabel(b.minHz, b.maxHz),
      minHz: b.minHz,
      maxHz: b.maxHz,
    }));
  }
  const nyquist = _sampleRate / 2;
  const defaultBands = standardDivBands(params.nBands, params.minFreq || 200);
  return defaultBands.map((b) => ({
    label: formatKhzBandLabel(b.minHz, Math.min(b.maxHz, nyquist)),
    minHz: b.minHz,
    maxHz: Math.min(b.maxHz, nyquist),
  }));
}

export function formatKhzBandLabel(minHz: number, maxHz: number): string {
  const lo = minHz / 1000;
  const hi = maxHz / 1000;
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ""));
  return `${fmt(lo)}–${fmt(hi)} kHz`;
}

function binsForHzBand(
  freqHz: Float32Array,
  minHz: number,
  maxHz: number,
  isLast: boolean
): [number, number] {
  let lo = 0;
  let hi = freqHz.length - 1;
  for (let i = 0; i < freqHz.length; i++) {
    if (freqHz[i] >= minHz) {
      lo = i;
      break;
    }
  }
  for (let i = freqHz.length - 1; i >= 0; i--) {
    const inBand = isLast ? freqHz[i] <= maxHz : freqHz[i] < maxHz;
    if (inBand && freqHz[i] >= minHz) {
      hi = i;
      break;
    }
  }
  return [lo, Math.max(lo, hi)];
}

function countActiveInBand(
  spec: SpectrogramData,
  minHz: number,
  maxHz: number,
  isLast: boolean,
  cutoff: number
): number {
  const [lo, hi] = binsForHzBand(spec.freqHz, minHz, maxHz, isLast);
  let n = 0;
  for (let b = lo; b <= hi; b++) {
    for (let f = 0; f < spec.frames; f++) {
      if (specDb(spec, b, f) > cutoff) n++;
    }
  }
  return n;
}

export interface BandInfo {
  label: string;
  minHz: number;
  maxHz: number;
  value: number;
}

function binRange(freqHz: Float32Array, minHz: number, maxHz: number): [number, number] {
  let lo = 0;
  let hi = freqHz.length - 1;
  for (let i = 0; i < freqHz.length; i++) {
    if (freqHz[i] >= minHz) {
      lo = i;
      break;
    }
  }
  for (let i = freqHz.length - 1; i >= 0; i--) {
    if (freqHz[i] <= maxHz) {
      hi = i;
      break;
    }
  }
  return [lo, Math.max(lo, hi)];
}

function countTotalInBand(
  spec: SpectrogramData,
  minHz: number,
  maxHz: number,
  isLast: boolean
): number {
  const [lo, hi] = binsForHzBand(spec.freqHz, minHz, maxHz, isLast);
  return Math.max(0, hi - lo + 1) * spec.frames;
}

/** Band proportions for ADI/AEI sandbox (prop.den 1 = within band, 2 = share of all active in range). */
export function diversityBandProportions(
  spec: SpectrogramData,
  params: IndexParams
): BandInfo[] {
  const cutoff = params.cutoff;
  const bandDefs = getEqualHzBands(params, spec.sampleRate);
  const propDen = params.propDen === 1 ? 1 : 2;

  if (propDen === 1) {
    return bandDefs.map((b, j) => {
      const above = countActiveInBand(
        spec,
        b.minHz,
        b.maxHz,
        j === bandDefs.length - 1,
        cutoff
      );
      const total = countTotalInBand(spec, b.minHz, b.maxHz, j === bandDefs.length - 1);
      return {
        label: b.label,
        minHz: b.minHz,
        maxHz: b.maxHz,
        value: total === 0 ? 0 : above / total,
      };
    });
  }

  let activeTotal = 0;
  bandDefs.forEach((b, j) => {
    activeTotal += countActiveInBand(
      spec,
      b.minHz,
      b.maxHz,
      j === bandDefs.length - 1,
      cutoff
    );
  });
  return bandDefs.map((b, j) => {
    const above = countActiveInBand(
      spec,
      b.minHz,
      b.maxHz,
      j === bandDefs.length - 1,
      cutoff
    );
    return {
      label: b.label,
      minHz: b.minHz,
      maxHz: b.maxHz,
      value: activeTotal === 0 ? 0 : above / activeTotal,
    };
  });
}

export function proportionsHint(propDen: number): string {
  if (propDen === 1) {
    return (
      "Within each band: (cells above cutoff) ÷ (all cells in that band). " +
      "Each value is between 0 and 1 and usually does not sum to 1 across bands."
    );
  }
  return (
    "Across the analysis range (Band 1 lower bound through last band upper bound): " +
    "(active cells in band) ÷ (all active cells in that range). Values sum to 1."
  );
}

/** @deprecated Use diversityBandProportions */
export const adiBandStats = diversityBandProportions;

function histogramMode(values: number[]): number {
  if (values.length === 0) return 0;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const v of values) {
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (Math.abs(maxV - minV) < 1e-12) return minV;
  const nBins = 40;
  const counts = new Array<number>(nBins).fill(0);
  const step = (maxV - minV) / nBins;
  for (const v of values) {
    let idx = Math.floor((v - minV) / step);
    if (idx >= nBins) idx = nBins - 1;
    counts[idx]++;
  }
  let maxCount = 0;
  let idx = 0;
  for (let i = 0; i < nBins; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      idx = i;
    }
  }
  return minV + (idx + 0.5) * step;
}

/** Per-bin FADI floating threshold (histogram noise + gamma, floored by global). */
export function fadiPerBinThreshold(
  spec: SpectrogramData,
  params: IndexParams
): Float32Array {
  const bandDefs = getEqualHzBands(params, spec.sampleRate);
  if (bandDefs.length === 0) return new Float32Array(spec.bins);
  const minHz = bandDefs[0].minHz;
  const maxHz = bandDefs[bandDefs.length - 1].maxHz;
  const thresholds = new Float32Array(spec.bins);

  const noiseDb = new Float32Array(spec.bins);
  for (let b = 0; b < spec.bins; b++) {
    if (spec.freqHz[b] > maxHz) continue;
    const row: number[] = [];
    for (let f = 0; f < spec.frames; f++) row.push(specDb(spec, b, f));
    noiseDb[b] = histogramMode(row);
  }

  let globalMax = -Infinity;
  for (let b = 0; b < spec.bins; b++) {
    const hz = spec.freqHz[b];
    if (hz < minHz || hz > maxHz) continue;
    for (let f = 0; f < spec.frames; f++) {
      globalMax = Math.max(globalMax, specDb(spec, b, f));
    }
  }
  const globalThr = globalMax + params.thresholdFixed;

  for (let b = 0; b < spec.bins; b++) {
    const floating = noiseDb[b] + params.gamma;
    thresholds[b] = Math.max(floating, globalThr);
  }
  return thresholds;
}

function bandScoreFadi(
  spec: SpectrogramData,
  minHz: number,
  maxHz: number,
  thresholds: Float32Array,
  isLast: boolean
): number {
  const [lo, hi] = binsForHzBand(spec.freqHz, minHz, maxHz, isLast);
  const startBin = lo + 1;
  if (startBin > hi) return 0;
  let above = 0;
  let total = 0;
  for (let bin = startBin; bin <= hi; bin++) {
    const thr = thresholds[bin];
    for (let f = 0; f < spec.frames; f++) {
      total++;
      if (specDb(spec, bin, f) > thr) above++;
    }
  }
  return total === 0 ? 0 : above / total;
}

/** Normalized within-band scores used in FADI Shannon (preview). */
export function fadiBandStats(spec: SpectrogramData, params: IndexParams): BandInfo[] {
  const bandDefs = getEqualHzBands(params, spec.sampleRate);
  const thresholds = fadiPerBinThreshold(spec, params);
  const raw = fadiRawBandScores(spec, params, bandDefs, thresholds);
  const sum = raw.reduce((a, v) => a + v, 0);
  return bandDefs.map((b, j) => ({
    label: b.label,
    minHz: b.minHz,
    maxHz: b.maxHz,
    value: sum === 0 ? 0 : raw[j] / sum,
  }));
}

function fadiRawBandScores(
  spec: SpectrogramData,
  params: IndexParams,
  bandDefs: ReturnType<typeof getEqualHzBands>,
  thresholds: Float32Array
): number[] {
  if (bandDefs.length === 0) return [];
  const thr =
    thresholds.length > 0
      ? thresholds
      : fadiPerBinThreshold(spec, params);
  return bandDefs.map((b, j) =>
    bandScoreFadi(spec, b.minHz, b.maxHz, thr, j === bandDefs.length - 1)
  );
}

export interface FadiCalcTerm {
  label: string;
  z: number;
  p: number;
  contribution: number;
}

export interface FadiCalcBreakdown {
  terms: FadiCalcTerm[];
  sumZ: number;
  fadi: number;
}

/** FADI = − Σ pᵢ ln(pᵢ + ε) with pᵢ = zᵢ / Σ zⱼ (floating threshold per bin). */
export function fadiCalcBreakdown(
  spec: SpectrogramData,
  params: IndexParams
): FadiCalcBreakdown {
  const bandDefs = getEqualHzBands(params, spec.sampleRate);
  if (bandDefs.length === 0) {
    return { terms: [], sumZ: 0, fadi: 0 };
  }
  const thresholds = fadiPerBinThreshold(spec, params);
  const raw = fadiRawBandScores(spec, params, bandDefs, thresholds);
  const sumZ = raw.reduce((a, v) => a + v, 0);
  if (sumZ === 0) {
    return { terms: [], sumZ: 0, fadi: 0 };
  }
  const terms = bandDefs.map((b, j) => {
    const z = raw[j];
    const p = z / sumZ;
    const contribution = p > 0 ? -p * Math.log(p + 1e-7) : 0;
    return { label: b.label, z, p, contribution };
  });
  const fadi = Math.round(terms.reduce((s, t) => s + t.contribution, 0) * 1_000_000) / 1_000_000;
  return { terms, sumZ, fadi };
}

export function shannonFromProportions(props: number[]): number {
  const total = props.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const norm = props.map((p) => p / total);
  let h = 0;
  for (const p of norm) {
    if (p > 0) h -= p * Math.log(p);
  }
  return Math.round(h * 1000) / 1000;
}

export interface AdiCalcTerm {
  label: string;
  p: number;
  contribution: number;
}

export interface AdiCalcBreakdown {
  terms: AdiCalcTerm[];
  adi: number;
}

export function adiCalcBreakdown(bands: BandInfo[]): AdiCalcBreakdown {
  const props = bands.map((b) => b.value);
  const total = props.reduce((a, b) => a + b, 0);
  if (total === 0 || bands.length === 0) {
    return { terms: [], adi: 0 };
  }
  const terms = bands.map((b, i) => {
    const pNorm = props[i] / total;
    const contribution = pNorm > 0 ? -pNorm * Math.log(pNorm) : 0;
    return { label: b.label, p: pNorm, contribution };
  });
  const adi = Math.round(terms.reduce((s, t) => s + t.contribution, 0) * 1000) / 1000;
  return { terms, adi };
}

export interface AeiCalcTerm {
  label: string;
  x: number;
  rank: number;
}

export interface AeiCalcBreakdown {
  terms: AeiCalcTerm[];
  weighted: number;
  sum: number;
  aei: number;
}

export function aeiCalcBreakdown(bands: BandInfo[]): AeiCalcBreakdown {
  if (bands.length === 0) {
    return { terms: [], weighted: 0, sum: 0, aei: 0 };
  }
  const withEps = bands.map((b) => ({ label: b.label, x: b.value + 0.000_001 }));
  const sorted = [...withEps].sort((a, b) => a.x - b.x);
  const n = sorted.length;
  const sum = sorted.reduce((a, t) => a + t.x, 0);
  if (sum === 0) {
    return { terms: [], weighted: 0, sum: 0, aei: 0 };
  }
  let weighted = 0;
  const terms = sorted.map((t, i) => {
    weighted += (i + 1) * t.x;
    return { label: t.label, x: t.x, rank: i + 1 };
  });
  const aei = Math.round(((2 * weighted) / (n * sum) - (n + 1) / n) * 1000) / 1000;
  return { terms, weighted, sum, aei };
}

export function giniFromProportions(props: number[]): number {
  const values = props.map((p) => p + 0.000_001).sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * values[i];
  return Math.round(((2 * weighted) / (n * sum) - (n + 1) / n) * 1000) / 1000;
}

export function fciBandStats(spec: SpectrogramData, params: IndexParams): BandInfo[] {
  const cutoff = params.cutoff;
  let ufMax = Math.min(params.ufMax, spec.sampleRate / 2);
  const defs: [string, number, number][] = [
    ["LFC", params.lfMin, params.lfMax],
    ["MFC", params.mfMin, params.mfMax],
    ["HFC", params.hfMin, params.hfMax],
    ["UFC", params.ufMin, ufMax],
  ];
  return defs.map(([label, minHz, maxHz]) => {
    const [lo, hi] = binRange(spec.freqHz, minHz, maxHz);
    const rows = hi - lo + 1;
    let active = 0;
    for (let b = lo; b <= hi; b++) {
      for (let f = 0; f < spec.frames; f++) {
        if (specDb(spec, b, f) > cutoff) active++;
      }
    }
    return {
      label,
      minHz,
      maxHz,
      value: rows === 0 ? 0 : active / (rows * spec.frames),
    };
  });
}

/** Simplified BBAI click-cell mask (matches broad-band vertical runs). */
export function bbaiClickMask(
  spec: SpectrogramData,
  params: IndexParams
): { mask: Uint8Array; value: number } {
  const { frames, bins } = spec;
  const mask = new Uint8Array(frames * bins);
  const cutoff = params.cutoff;
  let clickCells = 0;

  for (let f = 0; f < frames; f++) {
    const colActive: boolean[] = [];
    for (let b = 0; b < bins; b++) {
      colActive[b] = specDb(spec, b, f) > cutoff;
    }
    const diffs: boolean[] = [];
    for (let b = 0; b < bins - 1; b++) {
      const d = specDb(spec, b + 1, f) - specDb(spec, b, f);
      diffs[b] = !Number.isNaN(d) && Math.abs(d) < params.difference;
    }
    const contiguous = new Array<boolean>(diffs.length + 1).fill(false);
    let gap = 0;
    for (let j = 0; j < diffs.length; j++) {
      if (diffs[j]) {
        contiguous[j] = true;
        gap = 0;
      } else if (gap < params.gapAllowance) {
        gap++;
        contiguous[j] = true;
      }
    }
    let k = 0;
    while (k < contiguous.length) {
      const val = contiguous[k];
      let len = 1;
      while (k + len < contiguous.length && contiguous[k + len] === val) len++;
      if (val && len > params.clickLength) {
        for (let row = k; row < k + len && row < bins; row++) {
          mask[f * bins + row] = 1;
          clickCells++;
        }
      }
      k += len;
    }
  }

  const value = Math.round((clickCells / (frames * bins)) * 100000) / 1000;
  return { mask, value };
}
