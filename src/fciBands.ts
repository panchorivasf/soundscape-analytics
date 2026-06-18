import { hzToKhzInput, khzInputToHz } from "./freqUnits";

export interface FciBandParams {
  lfMin: number;
  lfMax: number;
  mfMin: number;
  mfMax: number;
  hfMin: number;
  hfMax: number;
  ufMin: number;
  ufMax: number;
}

const UPPER_FIELDS = [
  { id: "lf-max", label: "LFC upper (kHz)" },
  { id: "mf-max", label: "MFC upper (kHz)" },
  { id: "hf-max", label: "HFC upper (kHz)" },
  { id: "uf-max", label: "UFC upper (kHz)" },
] as const;

function gridId(prefix: string): string {
  return prefix ? `${prefix}fci-bands-grid` : "fci-bands-grid";
}

function lfLowId(prefix: string): string {
  return `${prefix}lf-min`;
}

function fieldId(prefix: string, baseId: string): string {
  return `${prefix}${baseId}`;
}

export function renderFciBandGrid(prefix: string, p: FciBandParams): void {
  const container = document.getElementById(gridId(prefix));
  if (!container) return;

  const inputCls = prefix ? "spec-param fci-band-input" : "fci-band-input";
  const rows: string[] = [
    `<label>LF low cut (kHz)
      <input id="${lfLowId(prefix)}" class="${inputCls}" type="number" step="0.1" min="0" value="${hzToKhzInput(p.lfMin)}" title="Lower edge of the LFC band" />
    </label>`,
  ];

  const uppers = [p.lfMax, p.mfMax, p.hfMax, p.ufMax];
  UPPER_FIELDS.forEach((f, i) => {
    rows.push(
      `<label>${f.label}
        <input id="${fieldId(prefix, f.id)}" class="${inputCls}" type="number" step="0.1" min="0" value="${hzToKhzInput(uppers[i])}" />
      </label>`
    );
  });

  container.innerHTML = rows.join("");
}

export function readFciBands(prefix: string, fallback: FciBandParams): FciBandParams {
  const lowEl = document.getElementById(lfLowId(prefix)) as HTMLInputElement | null;
  const lfMin = lowEl ? khzInputToHz(Number(lowEl.value)) : fallback.lfMin;

  const readUpper = (baseId: string, defaultHz: number): number => {
    const el = document.getElementById(fieldId(prefix, baseId)) as HTMLInputElement | null;
    if (!el) return defaultHz;
    const v = khzInputToHz(Number(el.value));
    return Number.isFinite(v) ? v : defaultHz;
  };

  let prev = lfMin;
  const lfMax = Math.max(prev + 1, readUpper("lf-max", fallback.lfMax));
  prev = lfMax;
  const mfMax = Math.max(prev + 1, readUpper("mf-max", fallback.mfMax));
  prev = mfMax;
  const hfMax = Math.max(prev + 1, readUpper("hf-max", fallback.hfMax));
  prev = hfMax;
  const ufMax = Math.max(prev + 1, readUpper("uf-max", fallback.ufMax));

  return {
    lfMin,
    lfMax,
    mfMin: lfMax,
    mfMax,
    hfMin: mfMax,
    hfMax,
    ufMin: hfMax,
    ufMax,
  };
}

export function applyFciBandsToDom(prefix: string, p: FciBandParams): void {
  renderFciBandGrid(prefix, p);
}

export function syncFciBandGrids(fromPrefix: string, toPrefix: string, fallback: FciBandParams): void {
  const bands = readFciBands(fromPrefix, fallback);
  applyFciBandsToDom(toPrefix, bands);
}

export function fciParamsFromIndex(p: {
  lfMin: number;
  lfMax: number;
  mfMin: number;
  mfMax: number;
  hfMin: number;
  hfMax: number;
  ufMin: number;
  ufMax: number;
}): FciBandParams {
  return {
    lfMin: p.lfMin,
    lfMax: p.lfMax,
    mfMin: p.mfMin,
    mfMax: p.mfMax,
    hfMin: p.hfMin,
    hfMax: p.hfMax,
    ufMin: p.ufMin,
    ufMax: p.ufMax,
  };
}
