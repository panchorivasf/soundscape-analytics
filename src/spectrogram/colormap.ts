const _VIRIDIS = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 83, 160],
  [49, 120, 172],
  [38, 153, 168],
  [31, 186, 135],
  [74, 214, 83],
  [160, 239, 33],
  [253, 231, 37],
];

const _INFERNO = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];

function lerpCmap(t: number, stops: number[][]): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const pos = t * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const f = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export type CmapName = "viridis" | "inferno";

export function cmap(t: number, name: CmapName = "viridis"): [number, number, number] {
  return lerpCmap(t, name === "inferno" ? _INFERNO : _VIRIDIS);
}
