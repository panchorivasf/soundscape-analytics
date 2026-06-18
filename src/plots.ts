import Plotly from "plotly.js-dist-min";
import { enrichResults } from "./metadata";
import type { EnrichedResult, IndexResult } from "./types";

type ValueField = "value" | "valueAvg" | "valueL" | "valueR";
type ChartType = "box" | "violin" | "bar" | "scatter" | "timeseries" | "timeseries_agg";
type GroupField = "sensorId" | "hour" | "dateKey" | "weekKey" | "monthKey";
type AggFn = "mean" | "median" | "sd";

interface PlotConfig {
  chartType: ChartType;
  indices: string[];
  valueField: ValueField;
  groupBy: GroupField;
  agg: AggFn;
  timeGroup: GroupField;
}

let getResults: () => IndexResult[] = () => [];

export function initPlots(resultsGetter: () => IndexResult[]): void {
  getResults = resultsGetter;
  document.getElementById("plot-btn")?.addEventListener("click", renderPlot);
}

export function refreshPlotOptions(): void {
  const results = getResults().filter((r) => !r.error);
  const container = document.getElementById("plot-index-checkboxes");
  if (!container) return;

  const indices = [...new Set(results.map((r) => r.index))].sort();
  const prevChecked = new Set(
    Array.from(container.querySelectorAll<HTMLInputElement>("input:checked")).map((el) => el.value)
  );
  const hadCheckboxes = container.children.length > 0;

  container.innerHTML = "";
  if (indices.length === 0) {
    container.innerHTML = '<span class="plot-empty-inline">Run index calculation first</span>';
    toggleAggControls();
    return;
  }

  for (const idx of indices) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = idx;
    input.checked = hadCheckboxes ? prevChecked.has(idx) : true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(idx.toUpperCase()));
    container.appendChild(label);
  }

  toggleAggControls();
}

function selectedPlotIndices(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>("#plot-index-checkboxes input:checked")
  )
    .map((el) => el.value)
    .sort();
}

function toggleAggControls(): void {
  const type = (document.getElementById("plot-type") as HTMLSelectElement)?.value;
  const aggRow = document.getElementById("plot-agg-row");
  const groupRow = document.getElementById("plot-group-row");
  if (!aggRow || !groupRow) return;
  const isTsAgg = type === "timeseries_agg";
  aggRow.hidden = !isTsAgg;
  groupRow.hidden = type === "scatter" || type === "timeseries";
}

function readPlotConfig(): PlotConfig {
  return {
    chartType: (document.getElementById("plot-type") as HTMLSelectElement).value as ChartType,
    indices: selectedPlotIndices(),
    valueField: (document.getElementById("plot-value") as HTMLSelectElement).value as ValueField,
    groupBy: (document.getElementById("plot-group") as HTMLSelectElement).value as GroupField,
    agg: (document.getElementById("plot-agg") as HTMLSelectElement).value as AggFn,
    timeGroup: (document.getElementById("plot-time-group") as HTMLSelectElement).value as GroupField,
  };
}

function filterData(cfg: PlotConfig): EnrichedResult[] {
  const all = enrichResults(getResults(), cfg.valueField);
  if (cfg.indices.length === 0) return [];
  const selected = new Set(cfg.indices);
  return all.filter((r) => selected.has(r.index));
}

function indexTitle(indices: string[]): string {
  return indices.length === 1 ? indices[0].toUpperCase() : indices.map((i) => i.toUpperCase()).join(" vs ");
}

function renderPlot(): void {
  const el = document.getElementById("plot-area");
  if (!el) return;
  const cfg = readPlotConfig();
  const data = filterData(cfg);

  if (cfg.indices.length === 0 || data.length === 0) {
    Plotly.purge(el);
    el.innerHTML =
      '<p class="plot-empty">Select at least one index with data, then click Update plot.</p>';
    return;
  }

  el.innerHTML = "";
  const multi = cfg.indices.length > 1;
  const title = `${indexTitle(cfg.indices)} — ${cfg.chartType.replace(/_/g, " ")}`;

  let layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "#1a1d23",
    plot_bgcolor: "#22262e",
    font: { color: "#e8eaed", size: 12 },
    margin: { t: 48, r: 24, b: 56, l: 64 },
    title: { text: title, font: { size: 14 } },
    xaxis: { gridcolor: "#3a3f4b", zerolinecolor: "#3a3f4b" },
    yaxis: {
      gridcolor: "#3a3f4b",
      zerolinecolor: "#3a3f4b",
      title: { text: multi ? "Value" : cfg.indices[0].toUpperCase() },
    },
    showlegend: multi || cfg.chartType === "scatter" || cfg.chartType === "timeseries",
  };

  let traces: Plotly.Data[] = [];

  switch (cfg.chartType) {
    case "box":
      traces = multi
        ? indexCompareCategoricalTraces(data, cfg.groupBy, "box")
        : categoricalTraces(data, cfg.groupBy, "box");
      layout.xaxis = {
        ...layout.xaxis,
        title: { text: multi ? "Index" : groupLabel(cfg.groupBy) },
      };
      break;
    case "violin":
      traces = multi
        ? indexCompareCategoricalTraces(data, cfg.groupBy, "violin")
        : categoricalTraces(data, cfg.groupBy, "violin");
      layout.xaxis = {
        ...layout.xaxis,
        title: { text: multi ? "Index" : groupLabel(cfg.groupBy) },
      };
      break;
    case "bar":
      traces = multi
        ? groupedBarByIndexTraces(data, cfg.groupBy, cfg.agg)
        : barSummaryTraces(data, cfg.groupBy, cfg.agg);
      layout.xaxis = { ...layout.xaxis, title: { text: groupLabel(cfg.groupBy) } };
      break;
    case "scatter":
      if (multi) {
        ({ traces, layout } = subplotTimeTraces(data, cfg, scatterBySite));
      } else {
        traces = scatterBySite(data);
        layout.xaxis = { ...layout.xaxis, title: { text: "Date/time" } };
      }
      break;
    case "timeseries":
      if (multi) {
        ({ traces, layout } = subplotTimeTraces(data, cfg, timeSeriesRaw));
      } else {
        traces = timeSeriesRaw(data);
        layout.xaxis = { ...layout.xaxis, title: { text: "Date/time" }, type: "date" };
      }
      break;
    case "timeseries_agg":
      if (multi) {
        ({ traces, layout } = subplotTimeTraces(data, cfg, (d, c) =>
          timeSeriesAggregated(d, c.timeGroup, c.agg)
        ));
      } else {
        traces = timeSeriesAggregated(data, cfg.timeGroup, cfg.agg);
        layout.xaxis = { ...layout.xaxis, title: { text: groupLabel(cfg.timeGroup) } };
      }
      break;
  }

  Plotly.newPlot(el, traces, layout, {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  });
}

function groupLabel(g: GroupField): string {
  const labels: Record<GroupField, string> = {
    sensorId: "Site / sensor",
    hour: "Hour of day",
    dateKey: "Date",
    weekKey: "Week",
    monthKey: "Month",
  };
  return labels[g];
}

function axisRef(row: number): { xaxis: string; yaxis: string } {
  if (row === 0) return { xaxis: "x", yaxis: "y" };
  const n = row + 1;
  return { xaxis: `x${n}`, yaxis: `y${n}` };
}

function subplotTimeTraces(
  data: EnrichedResult[],
  cfg: PlotConfig,
  buildTraces: (slice: EnrichedResult[], cfg: PlotConfig) => Plotly.Data[]
): { traces: Plotly.Data[]; layout: Partial<Plotly.Layout> } {
  const traces: Plotly.Data[] = [];
  const n = cfg.indices.length;
  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "#1a1d23",
    plot_bgcolor: "#22262e",
    font: { color: "#e8eaed", size: 12 },
    margin: { t: 48, r: 24, b: 40, l: 64 },
    title: {
      text: `${indexTitle(cfg.indices)} — ${cfg.chartType.replace(/_/g, " ")}`,
      font: { size: 14 },
    },
    grid: { rows: n, columns: 1, pattern: "independent", roworder: "top to bottom" },
    height: Math.max(360, n * 240),
    showlegend: true,
  };

  cfg.indices.forEach((idx, row) => {
    const slice = data.filter((d) => d.index === idx);
    const axes = axisRef(row);
    const yKey = row === 0 ? "yaxis" : (`yaxis${row + 1}` as keyof Plotly.Layout);
    (layout as Record<string, unknown>)[yKey as string] = {
      gridcolor: "#3a3f4b",
      zerolinecolor: "#3a3f4b",
      title: { text: idx.toUpperCase() },
    };
    const xKey = row === 0 ? "xaxis" : (`xaxis${row + 1}` as keyof Plotly.Layout);
    (layout as Record<string, unknown>)[xKey as string] = {
      gridcolor: "#3a3f4b",
      zerolinecolor: "#3a3f4b",
      title: {
        text:
          cfg.chartType === "timeseries_agg"
            ? groupLabel(cfg.timeGroup)
            : cfg.chartType === "scatter" || cfg.chartType === "timeseries"
              ? "Date/time"
              : "",
      },
      ...(cfg.chartType === "scatter" || cfg.chartType === "timeseries" ? { type: "date" } : {}),
    };

    for (const trace of buildTraces(slice, cfg)) {
      traces.push({ ...trace, ...axes, showlegend: row === 0 });
    }
  });

  return { traces, layout };
}

/** Multi-index: x = index, one trace per group (site, hour, etc.). */
function indexCompareCategoricalTraces(
  data: EnrichedResult[],
  groupBy: GroupField,
  type: "box" | "violin"
): Plotly.Data[] {
  const groups = [...new Set(data.map((d) => String(d[groupBy] ?? "unknown")))].sort();
  return groups.map((g) => {
    const pts = data.filter((d) => String(d[groupBy] ?? "unknown") === g);
    return {
      type,
      name: g,
      x: pts.map((d) => d.index.toUpperCase()),
      y: pts.map((d) => d.numericValue!),
      boxpoints: "outliers",
      marker: { size: 4 },
    } as Plotly.Data;
  });
}

/** Multi-index: grouped bars — x = group, color = index. */
function groupedBarByIndexTraces(
  data: EnrichedResult[],
  groupBy: GroupField,
  agg: AggFn
): Plotly.Data[] {
  const groups = [...new Set(data.map((d) => String(d[groupBy] ?? "unknown")))].sort();
  const indices = [...new Set(data.map((d) => d.index))].sort();
  return indices.map((idx) => ({
    type: "bar",
    name: idx.toUpperCase(),
    x: groups,
    y: groups.map((g) =>
      aggregate(
        data
          .filter((d) => d.index === idx && String(d[groupBy] ?? "unknown") === g)
          .map((d) => d.numericValue!),
        agg
      )
    ),
    hovertemplate: `${idx.toUpperCase()}<br>%{x}<br>%{y:.4f}<extra></extra>`,
  }));
}

function categoricalTraces(data: EnrichedResult[], groupBy: GroupField, type: "box" | "violin"): Plotly.Data[] {
  const groups = [...new Set(data.map((d) => String(d[groupBy] ?? "unknown")))].sort();
  return groups.map((g) => {
    const ys = data.filter((d) => String(d[groupBy] ?? "unknown") === g).map((d) => d.numericValue!);
    return {
      type,
      name: g,
      y: ys,
      x: Array(ys.length).fill(g),
      boxpoints: "outliers",
      marker: { size: 4 },
    } as Plotly.Data;
  });
}

function barSummaryTraces(data: EnrichedResult[], groupBy: GroupField, agg: AggFn): Plotly.Data[] {
  const groups = [...new Set(data.map((d) => String(d[groupBy] ?? "unknown")))].sort();
  const ys = groups.map((g) =>
    aggregate(
      data.filter((d) => String(d[groupBy] ?? "unknown") === g).map((d) => d.numericValue!),
      agg
    )
  );
  return [
    {
      type: "bar",
      x: groups,
      y: ys,
      marker: { color: "#5b9bd5" },
      hovertemplate: "%{x}<br>%{y:.4f}<extra></extra>",
    },
  ];
}

function scatterBySite(data: EnrichedResult[]): Plotly.Data[] {
  const sites = [...new Set(data.map((d) => d.sensorId))].sort();
  return sites.map((site) => {
    const pts = data.filter((d) => d.sensorId === site && d.datetime);
    return {
      type: "scatter",
      mode: "markers",
      name: site,
      x: pts.map((p) => p.datetime!),
      y: pts.map((p) => p.numericValue!),
      marker: { size: 7, opacity: 0.75 },
    };
  });
}

function timeSeriesRaw(data: EnrichedResult[]): Plotly.Data[] {
  const withTime = data.filter((d) => d.datetime).sort((a, b) => a.datetime!.getTime() - b.datetime!.getTime());
  const sites = [...new Set(withTime.map((d) => d.sensorId))].sort();
  if (sites.length <= 1) {
    return [
      {
        type: "scatter",
        mode: "lines+markers",
        name: sites[0] ?? "all",
        x: withTime.map((d) => d.datetime!),
        y: withTime.map((d) => d.numericValue!),
        line: { width: 1.5 },
        marker: { size: 5 },
      },
    ];
  }
  return sites.map((site) => {
    const pts = withTime.filter((d) => d.sensorId === site);
    return {
      type: "scatter",
      mode: "lines+markers",
      name: site,
      x: pts.map((p) => p.datetime!),
      y: pts.map((p) => p.numericValue!),
      line: { width: 1.5 },
      marker: { size: 5 },
    };
  });
}

function timeSeriesAggregated(data: EnrichedResult[], timeGroup: GroupField, agg: AggFn): Plotly.Data[] {
  const sites = [...new Set(data.map((d) => d.sensorId))].sort();
  if (sites.length <= 1) {
    return [aggTimeTrace(data, timeGroup, agg, sites[0] ?? "all")];
  }
  return sites.map((site) => aggTimeTrace(data.filter((d) => d.sensorId === site), timeGroup, agg, site));
}

function aggTimeTrace(data: EnrichedResult[], timeGroup: GroupField, agg: AggFn, name: string): Plotly.Data {
  const buckets = new Map<string, number[]>();
  for (const d of data) {
    const key = String(d[timeGroup] ?? "unknown");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(d.numericValue!);
  }
  const keys = [...buckets.keys()].sort();
  return {
    type: "scatter",
    mode: "lines+markers",
    name,
    x: keys,
    y: keys.map((k) => aggregate(buckets.get(k)!, agg)),
    line: { width: 2 },
    marker: { size: 6 },
  };
}

function aggregate(vals: number[], fn: AggFn): number {
  if (vals.length === 0) return NaN;
  if (fn === "mean") return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (fn === "median") {
    const s = [...vals].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

export function onResultsUpdated(): void {
  refreshPlotOptions();
  const panel = document.getElementById("tab-plots");
  if (panel?.classList.contains("active")) renderPlot();
}
