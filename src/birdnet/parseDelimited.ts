/** Minimal CSV/TSV parser (handles quoted fields). */
export function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length === 0) return [];

  const headerLine = lines.find((l) => l.trim().length > 0);
  if (!headerLine) return [];

  const headers = splitRow(headerLine, delimiter).map(normalizeHeader);
  const rows: Record<string, string>[] = [];

  let started = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!started) {
      started = true;
      continue;
    }
    const cells = splitRow(line, delimiter);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/** Normalize column headers for case-insensitive lookup (BirdNET GUI + Analyzer formats). */
export function normalizeHeader(h: string): string {
  return h
    .trim()
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function detectDelimiter(firstLine: string): string {
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

export function field(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const target = normalizeHeader(name);
    const key = Object.keys(row).find((k) => k === target);
    if (key && row[key] !== "") return row[key];
  }
  return "";
}

export function numField(row: Record<string, string>, ...names: string[]): number {
  const v = field(row, ...names);
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
