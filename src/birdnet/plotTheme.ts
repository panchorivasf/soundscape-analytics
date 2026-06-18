import type Plotly from "plotly.js-dist-min";

/** Plotly theme aligned with SoundscapeAnalytics dark UI (see plots.ts). */
export const BN_PLOT = {
  paper: "#1a1d23",
  plot: "#22262e",
  text: "#e8eaed",
  muted: "#8b949e",
  grid: "#3a3f4b",
  accent: "#58a6ff",
  accent2: "#3fb950",
  bar: "#388bfd",
  hist: "#484f58",
  histLine: "#6e7681",
  richness: ["#1f3d5c", "#388bfd", "#79c0ff"],
  /** Plotly built-in Viridis colorscale name */
  viridisScale: "Viridis",
} as const;

export const plotConfig: Partial<Plotly.Config> = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
};

export interface DarkLayoutOptions extends Omit<Partial<Plotly.Layout>, "title"> {
  title?: string | Partial<Plotly.Layout>["title"];
}

function axisTitle(text: string): Partial<Plotly.DataTitle> {
  return { text, font: { color: BN_PLOT.text, size: 12 } };
}

function baseAxis(extra: Partial<Plotly.LayoutAxis> = {}): Partial<Plotly.LayoutAxis> {
  return {
    gridcolor: BN_PLOT.grid,
    zerolinecolor: BN_PLOT.grid,
    linecolor: BN_PLOT.grid,
    tickfont: { color: BN_PLOT.text, size: 11 },
    ...extra,
  };
}

function normalizeTitle(
  title: DarkLayoutOptions["title"]
): Partial<Plotly.Layout>["title"] {
  if (typeof title === "string") {
    return { text: title, font: { color: BN_PLOT.text, size: 14 } };
  }
  if (title && typeof title === "object" && "text" in title) {
    return {
      ...title,
      font: { color: BN_PLOT.text, size: 14, ...(title.font ?? {}) },
    };
  }
  return title;
}

export function colorbar(title: string, extra: Partial<Plotly.ColorBar> = {}): Partial<Plotly.ColorBar> {
  return {
    title: { text: title, font: { color: BN_PLOT.text, size: 11 } },
    tickfont: { color: BN_PLOT.text, size: 10 },
    bgcolor: "rgba(26, 29, 35, 0.85)",
    bordercolor: BN_PLOT.grid,
    borderwidth: 1,
    ...extra,
  };
}

export function darkLayout(extra: DarkLayoutOptions = {}): Partial<Plotly.Layout> {
  const {
    title,
    xaxis,
    yaxis,
    xaxis2,
    yaxis2,
    xaxis3,
    yaxis3,
    ...rest
  } = extra;

  return {
    paper_bgcolor: BN_PLOT.paper,
    plot_bgcolor: BN_PLOT.plot,
    font: { color: BN_PLOT.text, size: 12 },
    margin: { t: 48, r: 48, b: 56, l: 64 },
    ...rest,
    title: normalizeTitle(title),
    xaxis: baseAxis(xaxis ?? {}),
    yaxis: baseAxis(yaxis ?? {}),
    ...(xaxis2 ? { xaxis2: baseAxis(xaxis2) } : {}),
    ...(yaxis2 ? { yaxis2: baseAxis(yaxis2) } : {}),
    ...(xaxis3 ? { xaxis3: baseAxis(xaxis3) } : {}),
    ...(yaxis3 ? { yaxis3: baseAxis(yaxis3) } : {}),
  };
}

export { axisTitle };
