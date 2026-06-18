import type {
  BirdNetRow,
  BirdnetListRow,
  CallDiversityMetrics,
  PhenoSort,
  VocalHyperRow,
} from "./types";

export function birdnetList(df: BirdNetRow[], sort: "n.days" | "n.calls" | "call.rate" = "n.days"): BirdnetListRow[] {
  const bySpecies = new Map<
    string,
    BirdnetListRow & { weeks: Map<string, number>; daily: Map<string, number>; dates: Set<string> }
  >();

  for (const row of df) {
    const key = `${row.scientificName}\0${row.commonName}`;
    let rec = bySpecies.get(key);
    if (!rec) {
      rec = {
        scientificName: row.scientificName,
        commonName: row.commonName,
        nDays: 0,
        nCalls: 0,
        callRate: 0,
        peakWeek: "",
        maxCallsDay: 0,
        peakDay: "",
        weeks: new Map(),
        daily: new Map(),
        dates: new Set(),
      };
      bySpecies.set(key, rec);
    }
    rec.nCalls++;
    if (row.date) rec.dates.add(row.date);
    const weekKey = weekStart(row.date);
    if (weekKey) rec.weeks.set(weekKey, (rec.weeks.get(weekKey) ?? 0) + 1);
    if (row.date) rec.daily.set(row.date, (rec.daily.get(row.date) ?? 0) + 1);
  }

  const out: BirdnetListRow[] = [];
  for (const rec of bySpecies.values()) {
    rec.nDays = rec.dates.size;
    rec.callRate = rec.nDays > 0 ? Math.round(rec.nCalls / rec.nDays) : 0;

    let peakWeek = "";
    let peakWeekN = -1;
    for (const [w, n] of rec.weeks) {
      if (n > peakWeekN) {
        peakWeekN = n;
        peakWeek = w;
      }
    }
    rec.peakWeek = peakWeek;

    let maxDay = 0;
    let peakDay = "";
    for (const [d, n] of rec.daily) {
      if (n > maxDay) {
        maxDay = n;
        peakDay = d;
      }
    }
    rec.maxCallsDay = maxDay;
    rec.peakDay = peakDay;

    out.push({
      scientificName: rec.scientificName,
      commonName: rec.commonName,
      nDays: rec.nDays,
      nCalls: rec.nCalls,
      callRate: rec.callRate,
      peakWeek: rec.peakWeek,
      maxCallsDay: rec.maxCallsDay,
      peakDay: rec.peakDay,
    });
  }

  if (sort === "n.days") {
    out.sort((a, b) => b.nDays - a.nDays || b.nCalls - a.nCalls);
  } else if (sort === "n.calls") {
    out.sort((a, b) => b.nCalls - a.nCalls || b.nDays - a.nDays);
  } else {
    out.sort((a, b) => b.callRate - a.callRate || b.nCalls - a.nCalls || b.nDays - a.nDays);
  }
  return out;
}

function weekStart(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function shannon(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return -values.reduce((s, n) => {
    if (n <= 0) return s;
    const p = n / total;
    return s + p * Math.log(p);
  }, 0);
}

function simpson(values: number[]): number {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return 1 - values.reduce((s, n) => s + (n / total) ** 2, 0);
}

export function callDiversity(data: BirdNetRow[]): CallDiversityMetrics {
  const list = birdnetList(data);
  const nDays = list.map((r) => r.nDays);
  const nCalls = list.map((r) => r.nCalls);
  const richness = list.length;
  const shD = shannon(nDays);
  const shC = shannon(nCalls);
  const logRich = richness > 1 ? Math.log(richness) : 1;
  return {
    shannonDays: round2(shD),
    shannonCalls: round2(shC),
    simpsonDays: round2(simpson(nDays)),
    simpsonCalls: round2(simpson(nCalls)),
    spRichness: richness,
    evennessDays: round2(shD / logRich),
    evennessCalls: round2(shC / logRich),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function vocalHyperdominance(
  data: BirdNetRow[],
  groupVar: "species" | "commonName" | "scientificName" | "order" | "family" = "scientificName",
  pastHalf = true
): VocalHyperRow[] {
  const counts = new Map<string, number>();
  for (const row of data) {
    let key = "";
    if (groupVar === "species") key = row.species ?? row.scientificName;
    else if (groupVar === "commonName") key = row.commonName;
    else if (groupVar === "order") key = row.order ?? "Unknown";
    else if (groupVar === "family") key = row.family ?? "Unknown";
    else key = row.scientificName;
    if (!key) key = "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()]
    .map(([taxon, detections]) => ({ taxon, detections }))
    .sort((a, b) => b.detections - a.detections);

  const total = sorted.reduce((s, r) => s + r.detections, 0);
  let cum = 0;
  const rows: VocalHyperRow[] = sorted.map((r) => {
    const percentage = total > 0 ? Math.round((r.detections / total) * 1000) / 10 : 0;
    cum = Math.round((cum + percentage) * 10) / 10;
    return { taxon: r.taxon, detections: r.detections, percentage, cumulative: cum };
  });

  if (pastHalf) {
    const idx = rows.findIndex((r) => r.cumulative >= 50);
    return idx >= 0 ? rows.slice(0, idx + 1) : rows;
  }
  return rows.filter((r) => r.cumulative <= 50);
}

export interface PhenoSpeciesInfo {
  name: string;
  useScientific: boolean;
  firstDetected: string;
  nDays: number;
  nCalls: number;
  callRate: number;
}

export function phenoSpeciesOrder(
  df: BirdNetRow[],
  minDays: number,
  sort: PhenoSort,
  desc: boolean
): { species: string[]; useScientific: boolean; info: PhenoSpeciesInfo[] } {
  const infoMap = new Map<string, PhenoSpeciesInfo & { dates: Set<string> }>();

  for (const row of df) {
    const useSci = sort === "scientific.name";
    const name = useSci ? row.scientificName : row.commonName;
    const key = name;
    let rec = infoMap.get(key);
    if (!rec) {
      rec = {
        name,
        useScientific: useSci,
        firstDetected: row.date,
        nDays: 0,
        nCalls: 0,
        callRate: 0,
        dates: new Set(),
      };
      infoMap.set(key, rec);
    }
    rec.nCalls++;
    rec.dates.add(row.date);
    if (row.date < rec.firstDetected) rec.firstDetected = row.date;
  }

  let info = [...infoMap.values()].map((r) => ({
    name: r.name,
    useScientific: r.useScientific,
    firstDetected: r.firstDetected,
    nDays: r.dates.size,
    nCalls: r.nCalls,
    callRate: r.dates.size > 0 ? Math.round(r.nCalls / r.dates.size) : 0,
  }));

  info = info.filter((r) => r.nDays >= minDays);

  const cmp = (a: PhenoSpeciesInfo, b: PhenoSpeciesInfo): number => {
    let v = 0;
    if (sort === "start") {
      v = a.firstDetected.localeCompare(b.firstDetected);
      return desc ? -v : v;
    }
    if (sort === "n.days") {
      v = a.nDays - b.nDays;
      return desc ? v : -v;
    }
    if (sort === "n.calls") {
      v = a.nCalls - b.nCalls;
      return desc ? v : -v;
    }
    if (sort === "call.rate") {
      v = a.callRate - b.callRate;
      return desc ? v : -v;
    }
    v = a.name.localeCompare(b.name);
    return desc ? -v : v;
  };
  info.sort(cmp);

  const useScientific = sort === "scientific.name";
  return { species: info.map((r) => r.name), useScientific, info };
}

export function hasTaxonomy(data: BirdNetRow[]): boolean {
  return data.some((r) => r.order && (r.family || r.species || r.scientificName));
}
