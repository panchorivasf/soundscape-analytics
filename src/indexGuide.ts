/** Acoustic index reference — descriptions, math, and literature context. */

import { isIndexUiVisible } from "./indicesConfig";
import { indexAnalyzeLabel } from "./indexLabels";
import { t } from "./i18n";

interface IndexEntry {
  id: string;
  name: string;
  summary: string;
  interpretation: string;
  math: string;
  literature: string;
}

const INDEX_ENTRIES: IndexEntry[] = [
  {
    id: "aci",
    name: "Acoustic Complexity Index (ACI)",
    summary: "Measures temporal variability of sound intensity across the spectrogram.",
    interpretation:
      "Higher ACI reflects more fluctuation in acoustic energy over time (e.g., diverse biophony, intermittent events). Very low values suggest constant noise or near-silence.",
    math: `For each frequency bin, successive time frames are differenced: D = |A<sub>t</sub> − A<sub>t−1</sub>|. Bins where D exceeds a threshold contribute. ACI = Σ D / Σ A (summed over qualifying bins).`,
    literature: `<strong>Origin:</strong> Pieretti, Farina & Morri (2011), <em>Ecological Indicators</em>.<br><strong>Goal:</strong> Quantify acoustic complexity in Mediterranean marine and terrestrial soundscapes as a proxy for habitat heterogeneity and biodiversity.`,
  },
  {
    id: "adi",
    name: "Acoustic Diversity Index (ADI)",
    summary: "Shannon diversity of acoustic activity distributed across equal frequency bands.",
    interpretation:
      "Higher ADI = activity spread across more frequency bands (richer spectral structure). Low ADI = energy concentrated in few bands (e.g., narrow machinery hum).",
    math: `The spectrum from min to max frequency is split into <em>n</em> equal bands (e.g. 0–1 kHz, 1–2 kHz, …). Proportion p<sub>i</sub> of active spectrogram cells per band. ADI = −Σ p<sub>i</sub> ln(p<sub>i</sub>) / ln(n).`,
    literature: `<strong>Origin:</strong> Villanueva-Rivera, L. J., B. C. Pijanowski, J. Doucette, and B. Pekin. 2011. A primer of acoustic analysis for landscape ecologists. <em>Landscape Ecology</em> 26: 1233–1246 (<a href="https://doi.org/10.1007/s10980-011-9636-9" target="_blank" rel="noopener noreferrer">doi:10.1007/s10980-011-9636-9</a>).<br><strong>Goal:</strong> Capture spectral diversity of soundscapes for long-term monitoring of ecosystems and anthropogenic change.`,
  },
  {
    id: "aei",
    name: "Acoustic Evenness Index (AEI)",
    summary: "Evenness of acoustic activity across the same equal frequency bands used for ADI.",
    interpretation:
      "High AEI = similar activity levels in all bands. Low AEI = one or few bands dominate the soundscape.",
    math: `Same band proportions p<sub>i</sub> as ADI (prop.den = 2). AEI applies a Gini-based evenness transform to those proportions.`,
    literature: `<strong>Origin:</strong> Villanueva-Rivera (2011); companion to ADI in the Purdue soundscape index suite.<br><strong>Goal:</strong> Distinguish “many bands equally active” from “many bands but one dominates.”`,
  },
  {
    id: "bi",
    name: "Bioacoustic Index (BI)",
    summary: "Contrast between acoustic energy in frequency ranges associated with biophony vs. anthrophony.",
    interpretation:
      "Higher BI often indicates greater biological acoustic activity in the classic BI bands used in avian monitoring. Interpretation is context- and calibration-dependent.",
    math: `Welch PSD integrated over configured frequency ranges; BI combines low- and mid-frequency power following the Boelman et al. formulation implemented in seewave/SoundEcology.`,
    literature: `<strong>Origin:</strong> Boelman et al. (2007), <em>Journal of Applied Ecology</em>; popularized for Arctic bird monitoring.<br><strong>Goal:</strong> Relate breeding-bird activity to acoustic energy in biologically relevant frequency ranges.`,
  },
  {
    id: "ndsi",
    name: "Normalized Difference Soundscape Index (NDSI)",
    summary: "Normalized contrast between anthropogenic and biological spectral energy.",
    interpretation:
      "NDSI near +1 → biophony dominates; near −1 → anthropophony dominates; ~0 → mixed or weak signal.",
    math: `NDSI = (B − A) / (B + A) where B and A are mean power in biological and anthropogenic bands (default 2–8 kHz and 1–2 kHz).`,
    literature: `<strong>Origin:</strong> Kasten et al. (2012), <em>Ecological Indicators</em>; builds on soundscape ecology concepts (Pijanowski et al. 2011, <em>Bioscience</em>).<br><strong>Goal:</strong> Separate human-generated from biological components of the soundscape for landscape-scale monitoring.`,
  },
  {
    id: "fadi",
    name: "Frequency-dependent ADI (FADI)",
    summary: "ADI computed on narrow sliding frequency windows with adaptive or fixed thresholds.",
    interpretation:
      "Captures fine-scale spectral diversity that broad ADI bands may mask; sensitive to narrow-band vocalizations.",
    math: `Sliding windows of width Δf; binary or thresholded spectrogram per window; Shannon diversity of band occupancy aggregated across windows (NEM variants for noise estimation).`,
    literature: `<strong>Origin:</strong> Xu et al. (2023), <em>Ecological Indicators</em> (<a href="https://doi.org/10.1016/j.ecolind.2023.110940" target="_blank" rel="noopener noreferrer">doi:10.1016/j.ecolind.2023.110940</a>).<br><strong>Goal:</strong> Improve sensitivity to frequency-specific acoustic patterns in heterogeneous soundscapes using a frequency-dependent extension of ADI with adaptive thresholding.`,
  },
  {
    id: "fci",
    name: "Frequency Coverage Indices (FCI)",
    summary:
      "Spectral coverage in low-, mid-, high-, and ultra-high-frequency bands (LFC, MFC, HFC, UFC): the fraction of spectrogram cells in each band where amplitude exceeds a cutoff.",
    interpretation:
      "Higher coverage in a band means more of that frequency range is acoustically active over the recording. Compare LFC vs MFC vs HFC to see whether activity concentrates in low rumble, mid-range biophony, or high-frequency components.",
    math: `For each band, coverage = (cells with amplitude &gt; cutoff) / (total cells in band).<br><br>
<strong>Low-frequency coverage (LFC):</strong> as for high-frequency coverage, in the low-frequency band (paper: &lt;482&nbsp;Hz; default here 0–1.5&nbsp;kHz, configurable).<br>
<strong>Mid-frequency coverage (MFC):</strong> as above, in the mid-frequency band (paper: 482&nbsp;Hz–4&nbsp;kHz; default here 1.5–8&nbsp;kHz, configurable).<br>
<strong>High-frequency coverage (HFC):</strong> as above, in the high-frequency band (paper: &gt;4&nbsp;kHz; default here 8–18&nbsp;kHz, configurable).<br>
<strong>Ultra-high-frequency coverage (UFC):</strong> same calculation in an optional upper band (extension beyond the original three-band scheme).<br><br>
Sankupellay et al. used a fixed linear-amplitude threshold (0.015) after background-noise removal. This app applies a user-set dBFS cutoff on the amplitude spectrogram (no separate noise-removal step).`,
    literature: `<strong>Origin:</strong> Sankupellay, Towsey, Truskinger &amp; Roe (2015), <em>IEEE International Symposium on Big Data Visual Analytics (BDVA)</em> (<a href="https://doi.org/10.1109/BDVA.2015.7314306" target="_blank" rel="noopener noreferrer">doi:10.1109/BDVA.2015.7314306</a>).<br><strong>Goal:</strong> Summarize how much of each frequency stratum is occupied by sound above threshold, as part of visual “fingerprints” of long-duration acoustic recordings.`,
  },
  {
    id: "nbai",
    name: "Narrow-Band Acoustic Index (NBAI)",
    summary: "Detects brief narrow-band energy peaks after high-pass filtering.",
    interpretation:
      "Higher NBAI = more narrow-band transient activity (e.g., insect stridulation, alarms, tonal calls).",
    math: `HPF → spectrogram → detect local spectral peaks exceeding neighbors by <em>difference</em> dB within <em>clickLength</em> bins.`,
    literature: `<strong>Origin:</strong> Díaz et al. (2022), <em>Ecological Indicators</em>; SoundEcology2 implementation (Rivas et al.).<br><strong>Goal:</strong> Quantify short, narrow-band biological signals in noisy field recordings.`,
  },
  {
    id: "bbai",
    name: "Broad-Band Acoustic Index (BBAI)",
    summary: "Detects vertical runs of similar energy across frequency — broad-band acoustic events.",
    interpretation:
      "Higher BBAI = more broad-band acoustic activity (rain, traffic rumble, mixed choruses, clicks).",
    math: `Cutoff spectrogram; per time frame, detect contiguous frequency runs with small frame-to-frame differences; aggregate active cell density.`,
    literature: `<strong>Origin:</strong> Rivas et al. (2025), <em>Methods in Ecology and Evolution</em> (<a href="https://doi.org/10.1111/2041-210X.70045" target="_blank" rel="noopener noreferrer">doi:10.1111/2041-210X.70045</a>).<br><strong>Goal:</strong> Capture wideband, transient sounds produced by rain and heavy insect activity.`,
  },
  {
    id: "tai",
    name: "Trill Activity Index (TAI)",
    summary: "Detects rapid repeated narrow-band events (trills) across time windows.",
    interpretation:
      "Higher TAI = more trill-like acoustic patterns, common in orthopteran and avian vocalizations.",
    math: `Recording split into <em>nWindows</em>; within each, detect click trains with configurable gap allowance; TAI aggregates trill density and low-frequency noise terms.`,
    literature: `<strong>Origin:</strong> Díaz et al. (2022), <em>Ecological Indicators</em>; SoundEcology2 (Rivas et al.).<br><strong>Goal:</strong> Automate detection of trill-rich acoustic activity for biodiversity assessment.`,
  },
];

const VISIBLE_INDEX_ENTRIES = INDEX_ENTRIES.filter((e) => isIndexUiVisible(e.id));

export function initIndexGuide(): void {
  const nav = document.getElementById("guide-nav");
  const content = document.getElementById("guide-content");
  if (!nav || !content) return;

  let activeId = VISIBLE_INDEX_ENTRIES[0]?.id ?? "aci";

  const renderNav = () => {
    nav.innerHTML = VISIBLE_INDEX_ENTRIES.map(
      (e) =>
        `<button type="button" class="guide-tab${e.id === activeId ? " active" : ""}" data-id="${e.id}">${indexAnalyzeLabel(e.id)}</button>`
    ).join("");
  };

  const render = (id: string) => {
    activeId = id;
    const entry = VISIBLE_INDEX_ENTRIES.find((e) => e.id === id) ?? VISIBLE_INDEX_ENTRIES[0];
    renderNav();
    content.innerHTML = `
      <article class="guide-article">
        <h2>${indexAnalyzeLabel(entry.id)}</h2>
        <p class="guide-lead">${entry.summary}</p>
        <section>
          <h3>${t("guide.interpretation")}</h3>
          <p>${entry.interpretation}</p>
        </section>
        <section>
          <h3>${t("guide.literature")}</h3>
          <p class="guide-lit">${entry.literature}</p>
        </section>
        <section>
          <h3>${t("guide.math")}</h3>
          <p class="guide-math">${entry.math}</p>
        </section>
      </article>`;
  };

  nav.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".guide-tab") as HTMLElement | null;
    if (btn?.dataset.id) render(btn.dataset.id);
  });

  window.addEventListener("app-i18n", () => render(activeId));

  render(activeId);
}

export function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".main-tab");
  const panels = document.querySelectorAll<HTMLElement>(".tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("active", p.id === `tab-${target}`));
    });
  });
}
