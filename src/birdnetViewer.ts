import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { birdnetList, callDiversity, hasTaxonomy, vocalHyperdominance } from "./birdnet/analytics";
import { renderBirdnetPlot, speciesOptions } from "./birdnet/charts";
import { addTaxonomy, taxonomyMatchStats } from "./birdnet/gbifTaxonomy";
import { importBirdnet } from "./birdnet/importBirdnet";
import type { BirdNetRow, BirdnetListRow, BirdnetVizType } from "./birdnet/types";

let loadedData: BirdNetRow[] = [];
let loadedPaths: string[] = [];
let taxonomyEnriched = false;
let lastRenderedViz: BirdnetVizType | null = null;

const VIZ_LABELS: Record<BirdnetVizType, string> = {
  list: "species list",
  histogram: "detection histogram",
  calendar: "calendar heatmap",
  pheno: "phenology chart",
  top_species: "top species",
  diversity: "diversity metrics",
  hyperdominance: "vocal hyperdominance",
  treemap: "taxon treemap",
};

const TABLE_VIZ_TYPES = new Set<BirdnetVizType>(["list", "diversity", "hyperdominance"]);

const $ = (id: string) => document.getElementById(id)!;

export function initBirdnetViewer(): void {
  $("bn-pick-files")?.addEventListener("click", () => void pickBirdnetFiles());
  $("bn-pick-folder")?.addEventListener("click", () => void pickBirdnetFolder());
  $("bn-clear")?.addEventListener("click", clearBirdnetData);
  $("bn-render")?.addEventListener("click", () => void renderCurrent());
  $("bn-add-taxonomy")?.addEventListener("click", () => void enrichTaxonomy());
  $("bn-viz-type")?.addEventListener("change", updateVizParamVisibility);

  updateVizParamVisibility();
  // Default viz is species list — show table pane
  ($("bn-plot-area") as HTMLElement).hidden = true;
  ($("bn-table-area") as HTMLElement).hidden = false;
}

async function pickBirdnetFiles(): Promise<void> {
  const selected = await open({
    multiple: true,
    filters: [
      { name: "BirdNET results", extensions: ["csv", "txt"] },
      { name: "All", extensions: ["*"] },
    ],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  await loadBirdnetFromPaths(paths);
}

async function pickBirdnetFolder(): Promise<void> {
  const folder = await open({ directory: true, multiple: false });
  if (!folder || Array.isArray(folder)) return;
  const recursive = ($("bn-recursive") as HTMLInputElement).checked;
  const paths = await invoke<string[]>("list_birdnet_in_folder", {
    folder,
    recursive,
  });
  if (paths.length === 0) {
    setBnStatus("No CSV/TXT files found in folder.", "error");
    return;
  }
  await loadBirdnetFromPaths(paths);
}

export async function loadBirdnetFromPaths(paths: string[]): Promise<void> {
  setBnStatus("Loading…", "");
  try {
    const files = await invoke<{ path: string; content: string }[]>("read_text_files", {
      paths,
    });
    const format = ($("bn-format") as HTMLSelectElement).value as "csv" | "txt";
    const conf = Number(($("bn-conf") as HTMLInputElement).value) || 0.5;
    loadedData = importBirdnet(files, { format, conf, combined: true });
    loadedPaths = paths;
    taxonomyEnriched = false;
    updateSummary();
    updateTaxonomyUi();
    populateSpeciesSelect();
    if (loadedData.length === 0) {
      const rawRows = files.reduce((n, f) => n + (f.content.split("\n").length - 1), 0);
      setBnStatus(
        rawRows > 0
          ? `No detections passed the confidence filter (≥ ${conf}). Try lowering min. confidence.`
          : `Loaded ${paths.length} file(s) but found no detection rows.`,
        rawRows > 0 ? "error" : ""
      );
      return;
    }
    setBnStatus(`Loaded ${loadedData.length} detections from ${paths.length} file(s).`, "ok");
    void renderCurrent();
  } catch (e) {
    setBnStatus(String(e), "error");
  }
}

export function switchToBirdnetTab(): void {
  document.querySelector<HTMLButtonElement>('.main-tab[data-tab="birdnet"]')?.click();
}

function clearBirdnetData(): void {
  loadedData = [];
  loadedPaths = [];
  taxonomyEnriched = false;
  lastRenderedViz = null;
  updateSummary();
  updateTaxonomyUi();
  const area = $("bn-plot-area");
  area.innerHTML = '<p class="plot-empty">Load BirdNET CSV or TXT exports to begin.</p>';
  const table = $("bn-table-area");
  table.innerHTML = "";
  setBnStatus("Cleared.", "");
}

function updateSummary(): void {
  const el = $("bn-summary");
  if (loadedData.length === 0) {
    el.textContent = "No data loaded";
    return;
  }
  const species = new Set(loadedData.map((r) => r.scientificName)).size;
  const dates = loadedData.map((r) => r.date).filter(Boolean).sort();
  const sensors = new Set(loadedData.map((r) => r.sensorId)).size;
  const range =
    dates.length > 0 ? `${dates[0]} – ${dates[dates.length - 1]}` : "—";
  const files =
    loadedPaths.length <= 2
      ? loadedPaths.map((p) => p.split(/[/\\]/).pop()).join(", ")
      : `${loadedPaths.length} files`;
  el.textContent = `${loadedData.length} detections · ${species} species · ${sensors} sensor(s) · ${range} · ${files}`;
}

function updateTaxonomyUi(): void {
  const btn = $("bn-add-taxonomy") as HTMLButtonElement;
  const taxEl = $("bn-taxonomy-summary");
  btn.disabled = loadedData.length === 0;

  if (loadedData.length === 0) {
    taxEl.textContent = "";
    return;
  }

  const { matched, total } = taxonomyMatchStats(loadedData);
  if (taxonomyEnriched || matched > 0) {
    taxEl.textContent = `GBIF taxonomy: ${matched}/${total} species matched`;
  } else {
    taxEl.textContent = "GBIF taxonomy: not enriched — use button above for treemap / family / order plots";
  }
}

async function enrichTaxonomy(): Promise<void> {
  if (loadedData.length === 0) return;
  const btn = $("bn-add-taxonomy") as HTMLButtonElement;
  btn.disabled = true;
  setBnStatus("Querying GBIF backbone…", "");

  try {
    loadedData = await addTaxonomy(loadedData, (p) => {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      setBnStatus(
        `GBIF: ${p.done}/${p.total} species (${pct}%)${p.current ? ` — ${p.current}` : ""}`,
        ""
      );
    });
    taxonomyEnriched = true;
    updateTaxonomyUi();
    const { matched, total } = taxonomyMatchStats(loadedData);
    setBnStatus(`GBIF taxonomy added — ${matched}/${total} species matched.`, "ok");
    btn.disabled = loadedData.length === 0;
    void renderCurrent();
  } catch (e) {
    setBnStatus(`GBIF lookup failed: ${String(e)}. Check internet connection.`, "error");
    btn.disabled = false;
  }
}

function populateSpeciesSelect(): void {
  const sel = $("bn-calendar-species") as HTMLSelectElement;
  const prev = sel.value;
  sel.innerHTML = '<option value="">All species</option>';
  for (const sp of speciesOptions(loadedData)) {
    const opt = document.createElement("option");
    opt.value = sp;
    opt.textContent = sp;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function readVizType(): BirdnetVizType {
  return ($("bn-viz-type") as HTMLSelectElement).value as BirdnetVizType;
}

/** Viz types that expose options under Visualization (not table-only or parameter-free plots). */
const VIZ_WITH_PARAMS = new Set<BirdnetVizType>([
  "histogram",
  "calendar",
  "pheno",
  "top_species",
  "hyperdominance",
  "treemap",
]);

function updateVizParamVisibility(): void {
  const type = readVizType();
  const paramArea = $("bn-viz-param-area");
  const hasParams = VIZ_WITH_PARAMS.has(type);
  paramArea.hidden = !hasParams;

  document.querySelectorAll<HTMLElement>("[data-bn-viz]").forEach((el) => {
    el.hidden = !hasParams || el.dataset.bnViz !== type;
  });

  const isTable = TABLE_VIZ_TYPES.has(type);
  ($("bn-plot-area") as HTMLElement).hidden = isTable;
  ($("bn-table-area") as HTMLElement).hidden = !isTable;

  if (loadedData.length > 0 && type !== lastRenderedViz) {
    showRenderPrompt(type);
  }
}

function showRenderPrompt(type: BirdnetVizType): void {
  const label = VIZ_LABELS[type] ?? type;
  const msg = `<p class="plot-empty">Click <strong>Render</strong> to view the ${label}.</p>`;
  if (TABLE_VIZ_TYPES.has(type)) {
    $("bn-table-area").innerHTML = msg;
    return;
  }
  const plotArea = $("bn-plot-area") as HTMLElement;
  plotArea.classList.remove("bn-tall-plot", "bn-plot-scroll");
  plotArea.style.minHeight = "";
  plotArea.style.height = "";
  plotArea.style.width = "";
  plotArea.innerHTML = msg;
}

async function renderCurrent(): Promise<void> {
  if (loadedData.length === 0) return;
  updateVizParamVisibility();
  const type = readVizType();

  if (type === "list") {
    renderListTable(birdnetList(loadedData));
    lastRenderedViz = type;
    return;
  }
  if (type === "diversity") {
    renderDiversityTable(callDiversity(loadedData));
    lastRenderedViz = type;
    return;
  }
  if (type === "hyperdominance") {
    const groupVar = ($("bn-hyper-group") as HTMLSelectElement).value as
      | "scientificName"
      | "commonName"
      | "order"
      | "family"
      | "species";
    const pastHalf = ($("bn-hyper-past-half") as HTMLInputElement).checked;
    renderHyperTable(vocalHyperdominance(loadedData, groupVar, pastHalf));
    lastRenderedViz = type;
    return;
  }

  const plotArea = $("bn-plot-area");
  plotArea.hidden = false;
  ($("bn-table-area") as HTMLElement).hidden = true;

  const opts: Record<string, unknown> = {};
  if (type === "histogram") {
    opts.yVar = ($("bn-hist-group") as HTMLSelectElement).value;
    opts.topN = Number(($("bn-hist-topn") as HTMLInputElement).value) || 5;
    opts.bins = Number(($("bn-hist-bins") as HTMLInputElement).value) || 30;
  } else if (type === "calendar") {
    opts.species = ($("bn-calendar-species") as HTMLSelectElement).value;
  } else if (type === "pheno") {
    opts.minDays = Number(($("bn-pheno-min-days") as HTMLInputElement).value) || 5;
    opts.sort = ($("bn-pheno-sort") as HTMLSelectElement).value;
    opts.desc = ($("bn-pheno-desc") as HTMLInputElement).checked;
    opts.title = ($("bn-pheno-title") as HTMLInputElement).value;
  } else if (type === "top_species") {
    opts.nSpecies = Number(($("bn-top-n") as HTMLInputElement).value) || 10;
    opts.siteId = ($("bn-top-site") as HTMLInputElement).value;
  } else if (type === "treemap") {
    if (!hasTaxonomy(loadedData)) {
      plotArea.innerHTML =
        '<p class="plot-empty">Treemap needs taxonomic ranks. Click <strong>Add taxonomy (GBIF)</strong> in the sidebar, then render again.</p>';
      lastRenderedViz = type;
      return;
    }
    opts.useCommonNames = ($("bn-treemap-common") as HTMLInputElement).checked;
  }

  await renderBirdnetPlot(plotArea, type, loadedData, opts);
  lastRenderedViz = type;
}

function renderListTable(rows: BirdnetListRow[]): void {
  const area = $("bn-table-area");
  if (rows.length === 0) {
    area.innerHTML = '<p class="plot-empty">No species in list.</p>';
    return;
  }
  const headers = [
    "Common name",
    "Scientific name",
    "Days",
    "Calls",
    "Call rate",
    "Peak week",
    "Max calls/day",
    "Peak day",
  ];
  let html = '<div class="bn-table-wrap"><table class="results-table bn-table"><thead><tr>';
  for (const h of headers) html += `<th>${h}</th>`;
  html += "</tr></thead><tbody>";
  for (const r of rows) {
    html += `<tr>
      <td>${esc(r.commonName)}</td>
      <td>${esc(r.scientificName)}</td>
      <td>${r.nDays}</td>
      <td>${r.nCalls}</td>
      <td>${r.callRate}</td>
      <td>${esc(r.peakWeek)}</td>
      <td>${r.maxCallsDay}</td>
      <td>${esc(r.peakDay)}</td>
    </tr>`;
  }
  html += "</tbody></table></div>";
  area.innerHTML = html;
}

function renderDiversityTable(m: ReturnType<typeof callDiversity>): void {
  const area = $("bn-table-area");
  area.innerHTML = `<div class="bn-table-wrap">
    <table class="results-table bn-table">
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Shannon (days)</td><td>${m.shannonDays}</td></tr>
        <tr><td>Shannon (calls)</td><td>${m.shannonCalls}</td></tr>
        <tr><td>Simpson (days)</td><td>${m.simpsonDays}</td></tr>
        <tr><td>Simpson (calls)</td><td>${m.simpsonCalls}</td></tr>
        <tr><td>Species richness</td><td>${m.spRichness}</td></tr>
        <tr><td>Evenness (days)</td><td>${m.evennessDays}</td></tr>
        <tr><td>Evenness (calls)</td><td>${m.evennessCalls}</td></tr>
      </tbody>
    </table>
  </div>`;
}

function renderHyperTable(rows: ReturnType<typeof vocalHyperdominance>): void {
  const area = $("bn-table-area");
  if (rows.length === 0) {
    area.innerHTML = '<p class="plot-empty">No data.</p>';
    return;
  }
  let html = `<div class="bn-table-wrap"><table class="results-table bn-table">
    <thead><tr><th>Taxon</th><th>Detections</th><th>%</th><th>Cumulative %</th></tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr><td>${esc(r.taxon)}</td><td>${r.detections}</td><td>${r.percentage}</td><td>${r.cumulative}</td></tr>`;
  }
  html += "</tbody></table></div>";
  area.innerHTML = html;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setBnStatus(msg: string, kind: "ok" | "error" | ""): void {
  const el = $("bn-status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}
