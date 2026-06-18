import type { BirdNetRow } from "./types";

const GBIF_MATCH = "https://api.gbif.org/v1/species/match";
const CONCURRENCY = 6;
const BATCH_DELAY_MS = 120;

export interface GbifTaxonomyRecord {
  searchName: string;
  status?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  matchType?: string;
}

interface GbifMatchResponse {
  matchType?: string;
  status?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  canonicalName?: string;
  scientificName?: string;
}

export interface AddTaxonomyProgress {
  done: number;
  total: number;
  current?: string;
}

/** Query GBIF backbone for one scientific name (rgbif::name_backbone equivalent). */
export async function matchGbifName(name: string): Promise<GbifTaxonomyRecord | null> {
  const url = `${GBIF_MATCH}?${new URLSearchParams({
    name,
    kingdom: "Animalia",
  })}`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) return null;
  const data = (await resp.json()) as GbifMatchResponse;
  if (!data.matchType || data.matchType === "NONE") {
    return { searchName: name, matchType: "NONE" };
  }
  return {
    searchName: name,
    status: data.status,
    order: data.order,
    family: data.family,
    genus: data.genus,
    species: speciesEpithet(data),
    matchType: data.matchType,
  };
}

function speciesEpithet(data: GbifMatchResponse): string | undefined {
  if (data.species && !data.species.includes(" ")) return data.species;
  const src = data.canonicalName ?? data.scientificName ?? "";
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return parts.slice(1).join(" ");
  return data.species;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Enrich rows with GBIF taxonomy (add_taxonomy equivalent). */
export async function addTaxonomy(
  rows: BirdNetRow[],
  onProgress?: (p: AddTaxonomyProgress) => void
): Promise<BirdNetRow[]> {
  const unique = [...new Set(rows.map((r) => r.scientificName.trim()).filter(Boolean))];
  const taxMap = new Map<string, GbifTaxonomyRecord>();

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    onProgress?.({ done: i, total: unique.length, current: batch[0] });

    const results = await Promise.all(batch.map((name) => matchGbifName(name)));
    for (let j = 0; j < batch.length; j++) {
      const rec = results[j];
      if (rec) taxMap.set(batch[j], rec);
    }

    onProgress?.({ done: Math.min(i + CONCURRENCY, unique.length), total: unique.length });
    if (i + CONCURRENCY < unique.length) await delay(BATCH_DELAY_MS);
  }

  return rows.map((row) => applyTaxonomy(row, taxMap.get(row.scientificName)));
}

function applyTaxonomy(row: BirdNetRow, tax?: GbifTaxonomyRecord): BirdNetRow {
  if (!tax || tax.matchType === "NONE") return row;
  return {
    ...row,
    taxStatus: tax.status ?? row.taxStatus,
    order: tax.order ?? row.order,
    family: tax.family ?? row.family,
    genus: tax.genus ?? row.genus,
    species: tax.species ?? row.species,
  };
}

export function taxonomyMatchStats(rows: BirdNetRow[]): { matched: number; total: number } {
  const unique = new Set(rows.map((r) => r.scientificName).filter(Boolean));
  let matched = 0;
  for (const name of unique) {
    const row = rows.find((r) => r.scientificName === name && r.order);
    if (row) matched++;
  }
  return { matched, total: unique.size };
}
