import { detectDelimiter, field, numField, parseDelimited } from "./parseDelimited";
import type { BirdNetRow } from "./types";

export interface ImportBirdnetOptions {
  format?: "csv" | "txt";
  conf?: number;
  combined?: boolean;
}

export interface FilePayload {
  path: string;
  content: string;
}

/** sensor_YYYYMMDD_HHMMSS from recording or CSV basename */
const RECORDING_ID_RE = /([A-Za-z0-9-]+_\d{8}_\d{6})/;

export function importBirdnet(
  files: FilePayload[],
  opts: ImportBirdnetOptions = {}
): BirdNetRow[] {
  const conf = opts.conf ?? 0.5;

  const parsedSets = files
    .map((f) => parseFile(f, opts.format))
    .filter((rows) => rows.length > 0);

  if (parsedSets.length === 0) return [];

  const merged = parsedSets.flat();
  return merged.filter(
    (r) =>
      r.confidence >= conf &&
      (r.scientificName.trim() !== "" || r.commonName.trim() !== "")
  );
}

function parseFile(file: FilePayload, format?: "csv" | "txt"): BirdNetRow[] {
  const csvBase = file.path.split(/[/\\]/).pop() ?? file.path;
  const isTxt = format === "txt" || csvBase.toLowerCase().endsWith(".txt");
  const delimiter = isTxt ? "\t" : detectDelimiter(file.content.split("\n")[0] ?? "");
  const raw = parseDelimited(file.content, delimiter);
  if (raw.length === 0) return [];

  return raw
    .map((row) => rowToBirdNet(row, file.path, csvBase))
    .filter((r) => r.scientificName !== "" || r.commonName !== "");
}

function rowToBirdNet(
  row: Record<string, string>,
  _filePath: string,
  csvBase: string
): BirdNetRow {
  const pathVal = field(row, "filepath", "file", "File", "path");
  const recordingStem = recordingStemFromPath(pathVal) ?? recordingStemFromPath(csvBase) ?? "";

  const { sensorId, date, time, datetime } = parseFilenameMeta(recordingStem);

  return {
    filename: recordingStem,
    sensorId,
    date,
    time,
    datetime,
    scientificName: field(row, "scientific name", "Scientific name", "species"),
    commonName: field(row, "common name", "Common name"),
    confidence: numField(row, "confidence", "Confidence") || 0,
    order: field(row, "order", "Order") || undefined,
    family: field(row, "family", "Family") || undefined,
    species: field(row, "species", "Species") || undefined,
    start: numField(row, "start", "Start (s)", "Start") || undefined,
    end: numField(row, "end", "End (s)", "End") || undefined,
  };
}

function recordingStemFromPath(pathOrName: string): string | null {
  if (!pathOrName) return null;
  const normalized = pathOrName.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  const withoutWav = base.replace(/\.wav$/i, "");
  const m = withoutWav.match(RECORDING_ID_RE);
  if (m) return m[1];
  const csvMatch = base.match(RECORDING_ID_RE);
  return csvMatch ? csvMatch[1] : null;
}

function parseFilenameMeta(stem: string): {
  sensorId: string;
  date: string;
  time: string;
  datetime: Date;
} {
  const m = stem.match(/^(.+)_(\d{8})_(\d{6})$/);
  if (!m) {
    return { sensorId: "", date: "", time: "", datetime: new Date(NaN) };
  }
  const sensorId = m[1];
  const ymd = m[2];
  const hms = m[3];
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const datetime = new Date(
    `${date}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`
  );
  return { sensorId, date, time: hms, datetime };
}

/** @internal test helper */
export function parseBirdnetSample(content: string, path: string): BirdNetRow[] {
  return importBirdnet([{ path, content }], { conf: 0.5 });
}
