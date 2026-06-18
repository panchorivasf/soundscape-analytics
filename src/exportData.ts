import { invoke } from "@tauri-apps/api/core";
import type { UnsavedArtifact } from "./unsavedWork";
import { markSaved } from "./unsavedWork";
import { save } from "@tauri-apps/plugin-dialog";
import Plotly from "plotly.js-dist-min";

export type TableFormat = "csv" | "xlsx" | "parquet";

export interface TableExportData {
  columns: string[];
  rows: string[][];
  defaultBaseName: string;
}

const FORMAT_META: Record<
  TableFormat,
  { label: string; extensions: string[] }
> = {
  csv: { label: "CSV", extensions: ["csv"] },
  xlsx: { label: "Excel", extensions: ["xlsx"] },
  parquet: { label: "Parquet", extensions: ["parquet"] },
};

export function readSelectedTableFormats(root: ParentNode): TableFormat[] {
  const formats: TableFormat[] = [];
  if (root.querySelector<HTMLInputElement>(".export-fmt-csv:checked")) formats.push("csv");
  if (root.querySelector<HTMLInputElement>(".export-fmt-xlsx:checked")) formats.push("xlsx");
  if (root.querySelector<HTMLInputElement>(".export-fmt-parquet:checked")) {
    formats.push("parquet");
  }
  return formats;
}

export async function exportTableData(
  data: TableExportData,
  formats: TableFormat[]
): Promise<string[]> {
  if (formats.length === 0) {
    throw new Error("Select at least one file format.");
  }
  if (data.rows.length === 0) {
    throw new Error("No table data to export.");
  }

  const saved: string[] = [];
  for (const format of formats) {
    const meta = FORMAT_META[format];
    const path = await save({
      filters: [{ name: meta.label, extensions: meta.extensions }],
      defaultPath: `${data.defaultBaseName}.${meta.extensions[0]}`,
    });
    if (!path) continue;

    await invoke("export_table", {
      columns: data.columns,
      rows: data.rows,
      path,
      format,
    });
    saved.push(path);
  }
  return saved;
}

const PLOTLY_CDN = "https://cdn.plot.ly/plotly-3.6.0.min.js";

function serializePlotJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Date) return v.toISOString();
    return v;
  });
}

export function buildPlotHtml(
  data: Plotly.Data[],
  layout: Partial<Plotly.Layout>,
  config: Partial<Plotly.Config> = {}
): string {
  const plotConfig = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    ...config,
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Soundscape Analytics plot</title>
  <script src="${PLOTLY_CDN}"></script>
  <style>
    html, body { margin: 0; height: 100%; background: #1a1d23; }
    #plot { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <div id="plot"></div>
  <script>
    Plotly.newPlot(
      "plot",
      ${serializePlotJson(data)},
      ${serializePlotJson(layout)},
      ${serializePlotJson(plotConfig)}
    );
  </script>
</body>
</html>`;
}

export function plotHasData(el: HTMLElement | null): el is Plotly.PlotlyHTMLElement {
  return !!el && !!(el as Plotly.PlotlyHTMLElement).data?.length;
}

export async function exportPlotPng(
  plotEl: Plotly.PlotlyHTMLElement,
  defaultBaseName: string
): Promise<void> {
  await Plotly.downloadImage(plotEl, {
    format: "png",
    width: 1400,
    height: 900,
    filename: defaultBaseName.replace(/\.(png|html)$/i, ""),
  });
}

export async function exportPlotHtml(
  plotEl: Plotly.PlotlyHTMLElement,
  defaultBaseName: string
): Promise<string | null> {
  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: `${defaultBaseName.replace(/\.(png|html)$/i, "")}.html`,
  });
  if (!path) return null;

  const html = buildPlotHtml(
    plotEl.data,
    plotEl.layout ?? {},
    (plotEl as Plotly.PlotlyHTMLElement & { config?: Partial<Plotly.Config> }).config ?? {}
  );
  await invoke("write_text_file", { path, content: html });
  return path;
}

export function wireTableExportBar(
  barId: string,
  getData: () => TableExportData | null,
  onStatus: (msg: string, kind: "ok" | "error" | "") => void,
  disabledWhen?: () => boolean,
  artifactId?: UnsavedArtifact
): () => void {
  const prefix = barId.replace(/-export-bar$/, "");
  const bar = document.getElementById(barId);
  const btn = document.getElementById(`${prefix}-export-table`);
  if (!bar || !btn) return () => {};

  const syncDisabled = () => {
    btn.toggleAttribute("disabled", disabledWhen?.() ?? false);
  };
  syncDisabled();

  btn.addEventListener("click", async () => {
    try {
      const data = getData();
      if (!data) throw new Error("No table data to export.");
      const formats = readSelectedTableFormats(bar);
      const paths = await exportTableData(data, formats);
      if (paths.length === 0) return;
      if (artifactId) markSaved(artifactId);
      onStatus(
        paths.length === 1 ? `Exported to ${paths[0]}` : `Exported ${paths.length} files`,
        "ok"
      );
    } catch (e) {
      onStatus(String(e), "error");
    }
  });

  return syncDisabled;
}

export function wirePlotExportBar(
  barId: string,
  getPlotEl: () => HTMLElement | null,
  defaultBaseName: string,
  onStatus: (msg: string, kind: "ok" | "error" | "") => void,
  artifactId?: UnsavedArtifact
): void {
  const prefix = barId.replace(/-export-bar$/, "");
  const pngBtn = document.getElementById(`${prefix}-export-png`);
  const htmlBtn = document.getElementById(`${prefix}-export-html`);
  if (!pngBtn || !htmlBtn) return;

  pngBtn.addEventListener("click", async () => {
    try {
      const el = getPlotEl();
      if (!plotHasData(el)) throw new Error("Render a plot first.");
      await exportPlotPng(el, defaultBaseName);
      if (artifactId) markSaved(artifactId);
      onStatus("PNG download started.", "ok");
    } catch (e) {
      onStatus(String(e), "error");
    }
  });

  htmlBtn.addEventListener("click", async () => {
    try {
      const el = getPlotEl();
      if (!plotHasData(el)) throw new Error("Render a plot first.");
      const path = await exportPlotHtml(el, defaultBaseName);
      if (path) {
        if (artifactId) markSaved(artifactId);
        onStatus(`Exported interactive HTML to ${path}`, "ok");
      }
    } catch (e) {
      onStatus(String(e), "error");
    }
  });
}
