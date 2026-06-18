import Plotly from "plotly.js-dist-min";
import { phenoSpeciesOrder, birdnetList } from "./analytics";
import {
  axisTitle,
  BN_PLOT,
  colorbar,
  darkLayout,
  plotConfig,
} from "./plotTheme";
import type { BirdNetRow, HistGroupVar, PhenoSort } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HIST_COLORS = ["#f85149", "#58a6ff", "#3fb950", "#d29922", "#bc8cff"];

export async function renderBirdnetPlot(
  el: HTMLElement,
  type: string,
  data: BirdNetRow[],
  opts: Record<string, unknown>
): Promise<void> {
  el.innerHTML = "";
  el.style.minHeight = "";
  el.style.height = "";
  el.style.width = "";
  el.classList.remove("bn-tall-plot", "bn-plot-scroll");
  if (data.length === 0) {
    el.innerHTML = '<p class="plot-empty">No detections after filtering.</p>';
    return;
  }

  switch (type) {
    case "histogram":
      await renderHistogram(el, data, opts);
      break;
    case "calendar":
      await renderCalendar(el, data, opts);
      break;
    case "pheno":
      await renderPheno(el, data, opts);
      break;
    case "top_species":
      await renderTopSpecies(el, data, opts);
      break;
    case "treemap":
      await renderTreemap(el, data, opts);
      break;
    default:
      el.innerHTML = '<p class="plot-empty">Select a visualization and click Render.</p>';
  }
}

function taxonKey(row: BirdNetRow, yVar: HistGroupVar): string {
  if (yVar === "family") return row.family ?? "Unknown";
  if (yVar === "order") return row.order ?? "Unknown";
  return binomialName(row) || row.scientificName;
}

/** Genus + species epithet, or full scientific name from BirdNET. */
function binomialName(row: BirdNetRow): string {
  const sci = row.scientificName.trim();
  if (sci.includes(" ")) return sci;
  if (row.genus && row.species) {
    const epithet = row.species.includes(" ") ? row.species.split(/\s+/).pop()! : row.species;
    return `${row.genus} ${epithet}`;
  }
  return sci || row.species || "";
}

function treemapSpeciesLabel(row: BirdNetRow, useCommonNames: boolean): string {
  if (useCommonNames) {
    const common = row.commonName.trim();
    if (common) return common;
  }
  return binomialName(row);
}

/** R-style pretty breaks for histogram bins. */
function prettyBreaks(min: number, max: number, nBins: number): number[] {
  if (min === max) return [min, min + 1];
  const range = max - min;
  const roughStep = range / Math.max(nBins, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / mag;
  let step: number;
  if (residual <= 1.5) step = mag;
  else if (residual <= 3) step = 2 * mag;
  else if (residual <= 7) step = 5 * mag;
  else step = 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const breaks: number[] = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) breaks.push(v);
  return breaks;
}

function binForValue(
  n: number,
  breaks: number[]
): { index: number; xmin: number; xmax: number; mid: number } | null {
  if (breaks.length < 2) return null;
  for (let i = 0; i < breaks.length - 1; i++) {
    const xmin = breaks[i];
    const xmax = breaks[i + 1];
    const inBin = i === 0 ? n >= xmin && n <= xmax : n >= xmin && n < xmax;
    if (inBin) return { index: i, xmin, xmax, mid: (xmin + xmax) / 2 };
  }
  const i = breaks.length - 2;
  return {
    index: i,
    xmin: breaks[i],
    xmax: breaks[i + 1],
    mid: (breaks[i] + breaks[i + 1]) / 2,
  };
}

async function renderHistogram(
  el: HTMLElement,
  data: BirdNetRow[],
  opts: Record<string, unknown>
): Promise<void> {
  const yVar = (opts.yVar as HistGroupVar) ?? "species";
  const topN = Math.max(0, (opts.topN as number) ?? 5);
  const bins = (opts.bins as number) ?? 30;
  const expX = (opts.expXFactor as number) ?? 1.3;

  const counts = new Map<string, number>();
  for (const row of data) {
    const k = taxonKey(row, yVar);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const tallies = [...counts.entries()]
    .map(([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n);

  if (tallies.length === 0) {
    el.innerHTML = '<p class="plot-empty">No taxa to plot.</p>';
    return;
  }

  const values = tallies.map((t) => t.n);
  const minN = Math.min(...values);
  const maxN = Math.max(...values);
  const breaks = prettyBreaks(minN, maxN, bins);
  const nBins = breaks.length - 1;

  const binCounts = new Array<number>(nBins).fill(0);
  for (const t of tallies) {
    const b = binForValue(t.n, breaks);
    if (b) binCounts[b.index]++;
  }

  const binMids = breaks.slice(0, -1).map((xmin, i) => (xmin + breaks[i + 1]) / 2);
  const binWidth = breaks.length > 1 ? breaks[1] - breaks[0] : 1;

  const barColors: string[] = binMids.map(() => BN_PLOT.hist);
  const top = topN > 0 ? tallies.slice(0, Math.min(topN, tallies.length)) : [];
  const maxY = Math.max(1, ...binCounts);

  interface LabelRow {
    name: string;
    n: number;
    binMid: number;
    binHeight: number;
    labelY: number;
    color: string;
  }
  const labelRows: LabelRow[] = [];

  for (let i = 0; i < top.length; i++) {
    const t = top[i];
    const b = binForValue(t.n, breaks);
    if (!b) continue;
    barColors[b.index] = HIST_COLORS[i % HIST_COLORS.length];
    labelRows.push({
      name: t.name,
      n: t.n,
      binMid: b.mid,
      binHeight: binCounts[b.index],
      labelY: binCounts[b.index] + maxY * 0.08,
      color: HIST_COLORS[i % HIST_COLORS.length],
    });
  }

  labelRows.sort((a, b) => a.binMid - b.binMid || a.labelY - b.labelY);
  const minSpacing = maxY * 0.1;
  for (let j = 1; j < labelRows.length; j++) {
    if (labelRows[j].labelY - labelRows[j - 1].labelY < minSpacing) {
      labelRows[j].labelY = labelRows[j - 1].labelY + minSpacing;
    }
  }

  const finalMaxY =
    labelRows.length > 0
      ? Math.max(maxY, ...labelRows.map((r) => r.labelY)) + maxY * 0.1
      : maxY * 1.08;

  const traces: Plotly.Data[] = [
    {
      type: "bar",
      x: binMids,
      y: binCounts,
      width: binWidth * 0.92,
      marker: {
        color: barColors,
        line: { color: BN_PLOT.histLine, width: 0.5 },
      },
      hovertemplate: "Detections: %{x:.0f}<br>Taxa in bin: %{y}<extra></extra>",
      showlegend: false,
    },
  ];

  const shapes: Partial<Plotly.Shape>[] = labelRows.map((l) => ({
    type: "line",
    xref: "x",
    yref: "y",
    x0: l.binMid,
    x1: l.binMid,
    y0: l.binHeight,
    y1: l.labelY,
    line: { color: l.color, width: 1, dash: "dash" },
  }));

  const annotations: Partial<Plotly.Annotations>[] = labelRows.map((l) => ({
    x: l.binMid,
    y: l.labelY,
    xref: "x",
    yref: "y",
    text: `${l.name}<br>(n=${l.n})`,
    showarrow: false,
    xanchor: "left",
    xshift: 6,
    bgcolor: l.color,
    bordercolor: BN_PLOT.grid,
    borderwidth: 1,
    borderpad: 4,
    font: { color: "#fff", size: 10 },
  }));

  const yLabel =
    yVar === "family"
      ? "Number of families"
      : yVar === "order"
        ? "Number of orders"
        : "Number of species";

  await Plotly.newPlot(
    el,
    traces,
    darkLayout({
      title: (opts.title as string) || "Detection count distribution",
      xaxis: {
        title: axisTitle("Number of Detections"),
        range: [Math.max(0, minN - binWidth * 0.5), maxN * expX],
      },
      yaxis: {
        title: axisTitle(yLabel),
        range: [0, finalMaxY],
      },
      margin: { t: 48, r: labelRows.length > 0 ? 160 : 48, b: 56, l: 64 },
      shapes,
      annotations,
      bargap: 0.05,
    }),
    plotConfig
  );
}

async function renderCalendar(
  el: HTMLElement,
  data: BirdNetRow[],
  opts: Record<string, unknown>
): Promise<void> {
  const species = (opts.species as string) || "";
  let subset = data;
  if (species) {
    subset = data.filter(
      (r) => r.scientificName === species || r.commonName === species
    );
  }

  const grid = new Map<string, number>();
  const monthsWithData = new Set<number>();
  for (const row of subset) {
    if (Number.isNaN(row.datetime.getTime())) continue;
    const m = row.datetime.getMonth();
    const h = row.datetime.getHours();
    monthsWithData.add(m);
    const key = `${m}-${h}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }

  const z: (number | null)[][] = [];
  for (let mi = 0; mi < 12; mi++) {
    const row: (number | null)[] = [];
    for (let h = 0; h < 24; h++) {
      if (!monthsWithData.has(mi)) row.push(null);
      else row.push(grid.get(`${mi}-${h}`) ?? 0);
    }
    z.push(row);
  }

  const maxCount = Math.max(1, ...z.flat().map((v) => v ?? 0));
  const titleText = species || "All birds";

  await Plotly.newPlot(
    el,
    [
      {
        type: "heatmap",
        x: Array.from({ length: 24 }, (_, i) => i),
        y: MONTHS,
        z,
        colorscale: BN_PLOT.viridisScale,
        zmin: 0,
        zmax: maxCount,
        colorbar: colorbar("Call count"),
        hovertemplate: "Hour %{x}<br>%{y}<br>Count: %{z}<extra></extra>",
      },
    ],
    darkLayout({
      title: {
        text: titleText,
        subtitle: { text: "Vocal activity", font: { color: BN_PLOT.muted, size: 11 } },
        font: { color: BN_PLOT.text, size: 14 },
      },
      xaxis: { title: axisTitle("Hour of the Day"), dtick: 1 },
      yaxis: { title: axisTitle("Month"), autorange: "reversed" },
      margin: { t: 64, r: 48, b: 56, l: 64 },
    }),
    plotConfig
  );
}

async function renderPheno(
  el: HTMLElement,
  data: BirdNetRow[],
  opts: Record<string, unknown>
): Promise<void> {
  const minDays = (opts.minDays as number) ?? 5;
  const sort = (opts.sort as PhenoSort) ?? "start";
  const desc = opts.desc !== false;
  const title = (opts.title as string) || "Phenology chart";

  const { species, useScientific } = phenoSpeciesOrder(data, minDays, sort, desc);
  if (species.length === 0) {
    el.innerHTML = '<p class="plot-empty">No species meet the minimum days threshold.</p>';
    return;
  }

  const filtered = data.filter((r) =>
    useScientific ? species.includes(r.scientificName) : species.includes(r.commonName)
  );

  const dates = [...new Set(filtered.map((r) => r.date))].sort();
  const mainZ: number[][] = species.map(() => dates.map(() => 0));
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const spIdx = new Map(species.map((s, i) => [s, i]));

  for (const row of filtered) {
    const name = useScientific ? row.scientificName : row.commonName;
    const si = spIdx.get(name)!;
    const di = dateIdx.get(row.date)!;
    mainZ[si][di]++;
  }

  const richness = dates.map((d) => {
    const sp = new Set(
      filtered.filter((r) => r.date === d).map((r) => r.commonName)
    );
    return sp.size;
  });

  const traces: Plotly.Data[] = [
    {
      type: "heatmap",
      x: dates,
      y: species,
      z: mainZ,
      colorscale: BN_PLOT.viridisScale,
      xaxis: "x",
      yaxis: "y",
      colorbar: colorbar("Calls/sp/day", { len: 0.85, y: 0.55 }),
    },
    {
      type: "heatmap",
      x: dates,
      y: ["Species/day"],
      z: [richness],
      colorscale: [
        [0, BN_PLOT.richness[0]],
        [0.5, BN_PLOT.richness[1]],
        [1, BN_PLOT.richness[2]],
      ],
      xaxis: "x2",
      yaxis: "y2",
      showscale: true,
      colorbar: colorbar("Species/day", { len: 0.15, y: 0.08 }),
    },
  ];

  await Plotly.newPlot(
    el,
    traces,
    darkLayout({
      title,
      height: Math.max(420, species.length * 20 + 160),
      grid: { rows: 2, columns: 1, roworder: "top to bottom", ygap: 0.12 },
      xaxis: { domain: [0, 1], anchor: "y", showticklabels: false },
      yaxis: { domain: [0.18, 1], anchor: "x", autorange: "reversed", tickfont: { size: 10 } },
      xaxis2: { domain: [0, 1], anchor: "y2", title: axisTitle("Date") },
      yaxis2: { domain: [0, 0.12], anchor: "x2", showticklabels: false },
      margin: { t: 52, r: 88, b: 56, l: 148 },
    }),
    plotConfig
  );

  const phenoHeight = Math.max(420, species.length * 20 + 160);
  el.classList.add("bn-tall-plot", "bn-plot-scroll");
  el.style.minHeight = `${phenoHeight}px`;
  el.style.height = `${phenoHeight}px`;
}

interface TopSpeciesPanel {
  key: "nDays" | "nCalls" | "callRate";
  title: string;
  subtitle: string;
  rows: ReturnType<typeof birdnetList>;
  xTitle: string;
  color: string;
}

async function renderTopSpeciesPanel(
  plotEl: HTMLElement,
  panel: TopSpeciesPanel,
  nSpecies: number,
  siteSuffix: string
): Promise<void> {
  if (panel.rows.length === 0) {
    plotEl.innerHTML = '<p class="plot-empty">No species to plot.</p>';
    return;
  }

  const rowPx = 36;
  const plotHeight = Math.max(320, nSpecies * rowPx + 140);

  if ((plotEl as Plotly.PlotlyHTMLElement).data) {
    Plotly.purge(plotEl);
  }
  plotEl.innerHTML = "";
  plotEl.style.minHeight = `${plotHeight}px`;
  plotEl.style.height = `${plotHeight}px`;

  await Plotly.newPlot(
    plotEl,
    [
      {
        type: "bar",
        orientation: "h",
        y: panel.rows.map((r) => r.commonName).reverse(),
        x: panel.rows.map((r) => r[panel.key]).reverse(),
        marker: { color: panel.color },
        showlegend: false,
        hovertemplate: `<b>%{y}</b><br>${panel.title}: %{x}<extra></extra>`,
      },
    ],
    darkLayout({
      title: {
        text: panel.title,
        subtitle: {
          text: `${panel.subtitle}${siteSuffix}`,
          font: { color: BN_PLOT.muted, size: 11 },
        },
        font: { color: BN_PLOT.text, size: 14 },
      },
      height: plotHeight,
      bargap: 0.28,
      xaxis: { title: axisTitle(panel.xTitle), tickfont: { size: 10 } },
      yaxis: { tickfont: { size: 10 }, automargin: true },
      margin: { t: 72, r: 32, b: 48, l: 188 },
    }),
    plotConfig
  );
}

async function renderTopSpecies(
  el: HTMLElement,
  data: BirdNetRow[],
  opts: Record<string, unknown>
): Promise<void> {
  const n = (opts.nSpecies as number) ?? 10;
  const siteSuffix = (opts.siteId as string) ? ` — ${opts.siteId as string}` : "";
  const list = birdnetList(data);

  const panels: TopSpeciesPanel[] = [
    {
      key: "nDays",
      title: "Days detected",
      subtitle: "Unique days with at least one detection",
      rows: [...list].sort((a, b) => b.nDays - a.nDays).slice(0, n),
      xTitle: "Number of days",
      color: BN_PLOT.accent2,
    },
    {
      key: "nCalls",
      title: "Total calls",
      subtitle: "All detections across the recording period",
      rows: [...list].sort((a, b) => b.nCalls - a.nCalls).slice(0, n),
      xTitle: "Number of calls",
      color: BN_PLOT.accent,
    },
    {
      key: "callRate",
      title: "Call rate",
      subtitle: "Mean calls per day detected (calls ÷ days)",
      rows: [...list].sort((a, b) => b.callRate - a.callRate).slice(0, n),
      xTitle: "Calls per day detected",
      color: BN_PLOT.bar,
    },
  ];

  el.innerHTML = "";
  el.style.minHeight = "";
  el.style.height = "";
  el.style.width = "";

  const carousel = document.createElement("div");
  carousel.className = "bn-top-carousel";

  const main = document.createElement("div");
  main.className = "bn-top-carousel-main";
  const plotHost = document.createElement("div");
  plotHost.className = "bn-top-carousel-plot";
  main.appendChild(plotHost);

  const nav = document.createElement("aside");
  nav.className = "bn-top-carousel-nav";
  nav.setAttribute("aria-label", "Top species charts");

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "bn-carousel-arrow";
  prevBtn.setAttribute("aria-label", "Previous chart");
  prevBtn.textContent = "‹";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "bn-carousel-arrow";
  nextBtn.setAttribute("aria-label", "Next chart");
  nextBtn.textContent = "›";

  const slideList = document.createElement("ul");
  slideList.className = "bn-top-carousel-slides";

  const slideButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bn-top-carousel-slide";
    btn.dataset.index = String(i);
    btn.innerHTML = `<span class="bn-top-carousel-slide-num">${i + 1}</span><span class="bn-top-carousel-slide-text"><span class="bn-top-carousel-slide-title">${p.title}</span><span class="bn-top-carousel-slide-sub">${p.subtitle}</span></span>`;
    btn.addEventListener("click", () => void goTo(i));
    li.appendChild(btn);
    slideList.appendChild(li);
    slideButtons.push(btn);
  }

  const counter = document.createElement("p");
  counter.className = "bn-top-carousel-counter";

  let current = 0;

  const updateNav = (): void => {
    slideButtons.forEach((btn, i) => {
      btn.classList.toggle("is-active", i === current);
      btn.setAttribute("aria-current", i === current ? "true" : "false");
    });
    counter.textContent = `${current + 1} / ${panels.length}`;
  };

  const goTo = async (index: number): Promise<void> => {
    const next = ((index % panels.length) + panels.length) % panels.length;
    if (next === current) return;
    current = next;
    updateNav();
    await renderTopSpeciesPanel(plotHost, panels[current], n, siteSuffix);
  };

  prevBtn.addEventListener("click", () => void goTo(current - 1));
  nextBtn.addEventListener("click", () => void goTo(current + 1));

  nav.appendChild(prevBtn);
  nav.appendChild(slideList);
  nav.appendChild(nextBtn);
  nav.appendChild(counter);

  carousel.appendChild(main);
  carousel.appendChild(nav);
  el.appendChild(carousel);

  updateNav();
  await renderTopSpeciesPanel(plotHost, panels[0], n, siteSuffix);
}

async function renderTreemap(
  el: HTMLElement,
  data: BirdNetRow[],
  opts: Record<string, unknown> = {}
): Promise<void> {
  const useCommonNames = opts.useCommonNames === true;
  const withTax = data.filter((r) => r.order && (r.scientificName || r.species));
  if (withTax.length === 0) {
    el.innerHTML =
      '<p class="plot-empty">Treemap needs taxonomic ranks. Click <strong>Add taxonomy (GBIF)</strong> in the sidebar, then render again.</p>';
    return;
  }

  const counts = new Map<string, { order: string; label: string; n: number }>();
  for (const row of withTax) {
    const label = treemapSpeciesLabel(row, useCommonNames);
    if (!label) continue;
    const key = `${row.order}\0${label}`;
    const rec = counts.get(key) ?? { order: row.order!, label, n: 0 };
    rec.n++;
    counts.set(key, rec);
  }

  const labels = ["All"];
  const parents = [""];
  const values = [0];
  for (const { order, label, n } of counts.values()) {
    if (!labels.includes(order)) {
      labels.push(order);
      parents.push("All");
      values.push(0);
    }
    labels.push(label);
    parents.push(order);
    values.push(n);
    values[0] += n;
    const oi = labels.indexOf(order);
    values[oi] += n;
  }

  await Plotly.newPlot(
    el,
    [
      {
        type: "treemap",
        labels,
        parents,
        values,
        branchvalues: "total",
        textinfo: "label+value",
        textfont: { color: BN_PLOT.text, size: 11 },
        marker: {
          line: { color: BN_PLOT.grid, width: 1 },
          colors: labels.map((_, i) =>
            i === 0 ? BN_PLOT.plot : `hsl(${(i * 47) % 360}, 45%, 42%)`
          ),
        },
        hoverlabel: { bgcolor: BN_PLOT.paper, font: { color: BN_PLOT.text } },
      } as Plotly.Data,
    ],
    darkLayout({
      title: useCommonNames
        ? "Distribution of detections by order (common names)"
        : "Distribution of detections by order (binomial names)",
      margin: { t: 48, l: 12, r: 12, b: 12 },
    }),
    plotConfig
  );
}

export function speciesOptions(data: BirdNetRow[]): string[] {
  const names = new Set<string>();
  for (const r of data) {
    if (r.scientificName) names.add(r.scientificName);
    if (r.commonName) names.add(r.commonName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
