import type { IndexParams } from "./types";
import {
  applyDivBandsToDom,
  readDivBands,
  syncDivBandGrids,
} from "./divBands";
import {
  applyFciBandsToDom,
  fciParamsFromIndex,
  readFciBands,
  syncFciBandGrids,
} from "./fciBands";
import { hzToKhzInput, khzInputToHz, readKhzField, readOptionalKhzField } from "./freqUnits";

let paramDefaults: IndexParams | null = null;

const FIELD_IDS = [
  "freq-res",
  "win-fun",
  "cutoff",
  "n-bands",
  "w-len",
  "channel-mode",
  "rm-offset",
  "aci-min-freq",
  "aci-max-freq",
  "bi-min-freq",
  "bi-max-freq",
  "anthro-min",
  "anthro-max",
  "bio-min",
  "bio-max",
  "hpf",
  "activity-cutoff",
  "n-windows",
  "click-length",
  "difference",
  "gap-allowance",
  "nem",
  "threshold-fixed",
  "gamma",
  "lf-min",
  "lf-max",
  "mf-max",
  "hf-max",
  "uf-max",
] as const;

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function numVal(id: string): number {
  const node = el(id) as HTMLInputElement | null;
  if (!node) return NaN;
  return Number(node.value);
}

function numValOr(id: string, fallback: number): number {
  const v = numVal(id);
  return Number.isFinite(v) ? v : fallback;
}

function numValKhzOr(id: string, fallbackHz: number): number {
  const node = el(id) as HTMLInputElement | null;
  if (!node) return fallbackHz;
  const v = Number(node.value);
  return Number.isFinite(v) ? khzInputToHz(v) : fallbackHz;
}

function optionalKhzOr(id: string, fallback: number | null): number | null {
  const node = el(id) as HTMLInputElement | null;
  if (!node) return fallback;
  const raw = node.value?.trim() ?? "";
  if (raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? khzInputToHz(v) : fallback;
}

export function setParamDefaults(p: IndexParams): void {
  paramDefaults = p;
}

export function getParamDefaults(): IndexParams | null {
  return paramDefaults;
}

export function readParamsFromDom(prefix = ""): IndexParams {
  const p = (id: string) => prefix + id;
  const base = paramDefaults;
  if (!base) {
    throw new Error("Default parameters are not loaded yet");
  }
  const nBands = numValOr(p("n-bands"), base.nBands);
  const divBandRanges = readDivBands(prefix, nBands);
  const rangeMin = divBandRanges[0]?.minHz ?? base.minFreq;
  const rangeMax = divBandRanges[divBandRanges.length - 1]?.maxHz ?? base.maxFreq ?? 10_000;

  const winEl = el(p("win-fun")) as HTMLSelectElement | null;
  const chEl = el(p("channel-mode")) as HTMLSelectElement | null;
  const rmEl = el(p("rm-offset")) as HTMLInputElement | null;
  const propDenEl = el(p("prop-den")) as HTMLSelectElement | null;
  const fciFallback = fciParamsFromIndex(base);
  const fci = readFciBands(prefix, fciFallback);

  return {
    ...base,
    freqRes: numValOr(p("freq-res"), base.freqRes),
    winFun: winEl?.value ?? base.winFun,
    minFreq: rangeMin,
    maxFreq: rangeMax,
    cutoff: numValOr(p("cutoff"), base.cutoff),
    nBands,
    divBandRanges,
    wLen: numValOr(p("w-len"), base.wLen),
    rmOffset: rmEl?.checked ?? base.rmOffset,
    aciMinFreq: numValKhzOr(p("aci-min-freq"), base.aciMinFreq),
    aciMaxFreq: optionalKhzOr(p("aci-max-freq"), base.aciMaxFreq),
    biMinFreq: numValKhzOr(p("bi-min-freq"), base.biMinFreq),
    biMaxFreq: numValKhzOr(p("bi-max-freq"), base.biMaxFreq),
    anthroMin: numValKhzOr(p("anthro-min"), base.anthroMin),
    anthroMax: numValKhzOr(p("anthro-max"), base.anthroMax),
    bioMin: numValKhzOr(p("bio-min"), base.bioMin),
    bioMax: numValKhzOr(p("bio-max"), base.bioMax),
    hpf: numValKhzOr(p("hpf"), base.hpf),
    activityCutoff: numValOr(p("activity-cutoff"), base.activityCutoff),
    nWindows: numValOr(p("n-windows"), base.nWindows),
    clickLength: numValOr(p("click-length"), base.clickLength),
    difference: numValOr(p("difference"), base.difference),
    gapAllowance: numValOr(p("gap-allowance"), base.gapAllowance),
    nem: numValOr(p("nem"), base.nem),
    thresholdFixed: numValOr(p("threshold-fixed"), base.thresholdFixed),
    gamma: numValOr(p("gamma"), base.gamma),
    lfMin: fci.lfMin,
    lfMax: fci.lfMax,
    mfMin: fci.mfMin,
    mfMax: fci.mfMax,
    hfMin: fci.hfMin,
    hfMax: fci.hfMax,
    ufMin: fci.ufMin,
    ufMax: fci.ufMax,
    channelMode: chEl?.value ?? base.channelMode ?? "mix",
    propDen: propDenEl ? Number(propDenEl.value) : base.propDen,
  };
}

export function applyParamsToDom(p: IndexParams, prefix = ""): void {
  const set = (id: string, value: string) => {
    const node = el(prefix + id) as HTMLInputElement | HTMLSelectElement | null;
    if (node) node.value = value;
  };
  const setKhz = (id: string, hz: number) => set(id, hzToKhzInput(hz));

  set("freq-res", String(p.freqRes));
  set("win-fun", p.winFun);
  set("cutoff", String(p.cutoff));
  set("n-bands", String(p.nBands));
  set("w-len", String(p.wLen));
  (el(prefix + "rm-offset") as HTMLInputElement).checked = p.rmOffset;
  setKhz("aci-min-freq", p.aciMinFreq);
  set("aci-max-freq", p.aciMaxFreq != null ? hzToKhzInput(p.aciMaxFreq) : "");
  setKhz("bi-min-freq", p.biMinFreq);
  setKhz("bi-max-freq", p.biMaxFreq);
  setKhz("anthro-min", p.anthroMin);
  setKhz("anthro-max", p.anthroMax);
  setKhz("bio-min", p.bioMin);
  setKhz("bio-max", p.bioMax);
  setKhz("hpf", p.hpf);
  set("activity-cutoff", String(p.activityCutoff));
  set("n-windows", String(p.nWindows));
  set("click-length", String(p.clickLength));
  set("difference", String(p.difference));
  set("gap-allowance", String(p.gapAllowance));
  set("nem", String(p.nem));
  set("threshold-fixed", String(p.thresholdFixed));
  set("gamma", String(p.gamma));
  applyFciBandsToDom(prefix, fciParamsFromIndex(p));
  set("channel-mode", p.channelMode ?? "mix");
  set("prop-den", String(p.propDen ?? 2));
  applyDivBandsToDom(prefix, p.divBandRanges);
}

/** Copy index-parameter fields between Analyze (no prefix) and Sandbox (`sb-`). */
export function syncParamForms(fromPrefix: string, toPrefix: string): void {
  for (const id of FIELD_IDS) {
    const from = el(fromPrefix + id);
    const to = el(toPrefix + id);
    if (!from || !to) continue;
    if (from instanceof HTMLInputElement && from.type === "checkbox") {
      (to as HTMLInputElement).checked = from.checked;
    } else if (from instanceof HTMLSelectElement && to instanceof HTMLSelectElement) {
      to.value = from.value;
    } else if (from instanceof HTMLInputElement && to instanceof HTMLInputElement) {
      to.value = from.value;
    }
  }
  const nBands = Number((el(fromPrefix + "n-bands") as HTMLInputElement)?.value ?? 10);
  syncDivBandGrids(fromPrefix, toPrefix, nBands);
  const base = paramDefaults!;
  syncFciBandGrids(fromPrefix, toPrefix, fciParamsFromIndex(base));
}

export function readViewFreqRange(nyquist: number): { fMin: number; fMax: number } {
  const fMin = readKhzField("sb-view-min-freq");
  const maxRaw = readOptionalKhzField("sb-view-max-freq");
  const fMax = maxRaw ?? nyquist;
  return {
    fMin: Math.max(0, Math.min(fMin, nyquist)),
    fMax: Math.max(fMin + 1, Math.min(fMax, nyquist)),
  };
}
