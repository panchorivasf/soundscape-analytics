import type { EnrichedResult, IndexResult } from "./types";

/** Parse Wildlife Acoustics SM-style names: {sensor}_{YYYYMMDD}_{HHMMSS}.wav */
export function parseFileMetadata(fileName: string): {
  sensorId: string;
  datetime: Date | null;
  dateKey: string | null;
  weekKey: string | null;
  monthKey: string | null;
  hour: number | null;
} {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const parts = base.replace(/\.wav$/i, "").split("_");

  if (parts.length >= 3 && /^\d{8}$/.test(parts[1]) && /^\d{6}$/.test(parts[2])) {
    const sensorId = parts[0];
    const y = parts[1].slice(0, 4);
    const mo = parts[1].slice(4, 6);
    const d = parts[1].slice(6, 8);
    const h = parts[2].slice(0, 2);
    const mi = parts[2].slice(2, 4);
    const s = parts[2].slice(4, 6);
    const datetime = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
    const dateKey = `${y}-${mo}-${d}`;
    const monthKey = `${y}-${mo}`;
    const weekKey = isoWeekKey(datetime);
    return {
      sensorId,
      datetime: Number.isNaN(datetime.getTime()) ? null : datetime,
      dateKey,
      weekKey,
      monthKey,
      hour: Number(h),
    };
  }

  const stem = base.replace(/\.wav$/i, "");
  return {
    sensorId: stem.slice(0, 24) || "unknown",
    datetime: null,
    dateKey: null,
    weekKey: null,
    monthKey: null,
    hour: null,
  };
}

function isoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function enrichResults(
  results: IndexResult[],
  valueField: "value" | "valueAvg" | "valueL" | "valueR"
): EnrichedResult[] {
  return results
    .filter((r) => !r.error)
    .map((r) => {
      const meta = parseFileMetadata(r.fileName);
      const numericValue = r[valueField] ?? r.value ?? r.valueAvg;
      return { ...r, ...meta, numericValue };
    })
    .filter((r) => r.numericValue != null && !Number.isNaN(r.numericValue));
}
