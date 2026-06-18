/** Convert Hz to a compact kHz string for number inputs. */
export function hzToKhzInput(hz: number): string {
  const k = hz / 1000;
  if (Number.isInteger(k)) return String(k);
  return k.toFixed(2).replace(/\.?0+$/, "");
}

export function khzInputToHz(khz: number): number {
  return khz * 1000;
}

export function readKhzField(id: string): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return khzInputToHz(Number(el?.value ?? 0));
}

export function readOptionalKhzField(id: string): number | null {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const raw = el?.value?.trim() ?? "";
  if (raw === "") return null;
  return khzInputToHz(Number(raw));
}

/** Y-axis / band label (e.g. 2 kHz, 10 kHz). */
export function formatFreqAxisKhz(hz: number): string {
  const k = hz / 1000;
  if (k >= 10 && Number.isInteger(k)) return `${k} kHz`;
  if (k >= 1) return `${k % 1 === 0 ? k : k.toFixed(1)} kHz`;
  return `${Math.round(hz)} Hz`;
}
