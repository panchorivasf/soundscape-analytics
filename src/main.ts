import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { initBirdnetViewer } from "./birdnetViewer";
import { initBirdnetAnalyzer } from "./birdnetAnalyzer";
import { initFalseColorSpectrograms } from "./falseColorSpectrograms";
import { initIndexGuide, initTabs } from "./indexGuide";
import { initI18n, t } from "./i18n";
import { filterVisibleIndices } from "./indicesConfig";
import { indexAnalyzeLabel } from "./indexLabels";
import { applyParamsToDom, readParamsFromDom, setParamDefaults } from "./paramsForm";
import { initDivBandEditors } from "./divBands";
import {
  initSpectrogramViewer,
  refreshSpectrogramFiles,
  syncProportionsDescFromParams,
} from "./spectrogramViewer";
import { initPlots, onResultsUpdated } from "./plots";
import type { IndexParams, IndexResult } from "./types";

let selectedFiles: string[] = [];
let lastResults: IndexResult[] = [];

const $ = (id: string) => document.getElementById(id)!;

function setStatus(msg: string, kind: "ok" | "error" | "" = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${kind}`;
}

function fmt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(4);
}

function readParams(): IndexParams {
  return readParamsFromDom("");
}

function applyDefaults(p: IndexParams) {
  setParamDefaults(p);
  applyParamsToDom(p, "");
  applyParamsToDom(p, "sb-");
}

function updateFileSummary() {
  const el = $("file-summary");
  if (selectedFiles.length === 0) {
    el.textContent = t("toolbar.noFiles");
    void refreshSpectrogramFiles();
    return;
  }
  if (selectedFiles.length === 1 && !selectedFiles[0].toLowerCase().endsWith(".wav")) {
    const name = selectedFiles[0].split(/[/\\]/).pop() ?? selectedFiles[0];
    el.textContent = `Folder: ${name}`;
    void refreshSpectrogramFiles();
    return;
  }
  const names = selectedFiles.map((f) => f.split(/[/\\]/).pop() ?? f);
  if (names.length <= 3) {
    el.textContent = `${names.length} file(s): ${names.join(", ")}`;
  } else {
    el.textContent = `${names.length} files — ${names.slice(0, 2).join(", ")} …`;
  }
  void refreshSpectrogramFiles();
}

function selectedIndices(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>("#index-checkboxes input:checked")
  ).map((el) => el.value);
}

function renderResults(results: IndexResult[]) {
  const tbody = $("results-table").querySelector("tbody")!;
  tbody.innerHTML = "";
  for (const r of results) {
    const tr = document.createElement("tr");
    if (r.error) {
      tr.innerHTML = `
        <td>${r.fileName}</td>
        <td>${r.index.toUpperCase()}</td>
        <td colspan="5" class="err">${r.error}</td>`;
    } else {
      const val = r.value ?? r.valueAvg;
      tr.innerHTML = `
        <td>${r.fileName}</td>
        <td>${r.index.toUpperCase()}</td>
        <td>${fmt(val)}</td>
        <td>${fmt(r.valueL)}</td>
        <td>${fmt(r.valueR)}</td>
        <td>${fmt(r.valueAvg)}</td>
        <td>${r.duration.toFixed(1)}s</td>`;
    }
    tbody.appendChild(tr);
  }
}

function wireUiHandlers(): void {
  $("close-app").addEventListener("click", () => {
    void getCurrentWindow().close();
  });

  $("pick-files").addEventListener("click", async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "WAV", extensions: ["wav"] }],
    });
    if (picked) {
      selectedFiles = Array.isArray(picked) ? picked : [picked];
      updateFileSummary();
    }
  });

  $("pick-folder").addEventListener("click", async () => {
    const folder = await open({ directory: true, multiple: false });
    if (folder && typeof folder === "string") {
      selectedFiles = [folder];
      updateFileSummary();
      setStatus(t("analyze.folderSelected"));
    }
  });

  $("clear-files").addEventListener("click", () => {
    selectedFiles = [];
    updateFileSummary();
    setStatus("");
  });

  $("compute").addEventListener("click", async () => {
    if (selectedFiles.length === 0) {
      setStatus(t("analyze.selectFiles"), "error");
      return;
    }
    const indicesSel = selectedIndices();
    if (indicesSel.length === 0) {
      setStatus(t("analyze.selectIndex"), "error");
      return;
    }

    const threadsRaw = ($("num-threads") as HTMLInputElement).value;
    const numThreads = threadsRaw ? Number(threadsRaw) : null;

    $("compute").setAttribute("disabled", "true");
    setStatus(t("analyze.computing"));

    try {
      const t0 = performance.now();
      const results = await invoke<IndexResult[]>("compute_indices", {
        request: {
          files: selectedFiles,
          indices: indicesSel,
          params: readParams(),
          numThreads,
        },
      });
      lastResults = results;
      renderResults(results);
      onResultsUpdated();
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      setStatus(t("analyze.done", { count: results.length, time: elapsed }), "ok");
      ($("export-csv") as HTMLButtonElement).disabled = results.length === 0;
    } catch (e) {
      setStatus(String(e), "error");
    } finally {
      $("compute").removeAttribute("disabled");
    }
  });

  $("export-csv").addEventListener("click", async () => {
    const path = await save({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      defaultPath: "soundscape_analytics_results.csv",
    });
    if (path) {
      await invoke("export_csv", { results: lastResults, path });
      setStatus(t("analyze.exported", { path }), "ok");
    }
  });

  document.getElementById("plot-type")?.addEventListener("change", () => {
    const type = (document.getElementById("plot-type") as HTMLSelectElement).value;
    const aggRow = document.getElementById("plot-agg-row");
    const groupRow = document.getElementById("plot-group-row");
    if (aggRow) aggRow.hidden = type !== "timeseries_agg";
    if (groupRow) groupRow.hidden = type === "scatter" || type === "timeseries";
  });

  document.querySelectorAll(".main-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = (tab as HTMLElement).dataset.tab;
      if (name === "plots") onResultsUpdated();
      if (name === "sandbox") {
        void refreshSpectrogramFiles();
      }
    });
  });
}

async function populateIndexCheckboxes(): Promise<void> {
  const container = $("index-checkboxes");
  container.replaceChildren();
  try {
    const indices = filterVisibleIndices(await invoke<string[]>("available_indices"));
    for (const idx of indices) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = idx;
      input.checked = false;
      label.appendChild(input);
      label.appendChild(document.createTextNode(indexAnalyzeLabel(idx)));
      container.appendChild(label);
    }
  } catch (e) {
    const msg = document.createElement("p");
    msg.className = "err";
    msg.textContent = t("analyze.loadIndicesErr", { error: String(e) });
    container.appendChild(msg);
  }
}

async function init() {
  initI18n();
  initTabs();
  initIndexGuide();
  wireUiHandlers();

  initDivBandEditors("");
  initPlots(() => lastResults);
  initBirdnetViewer();
  initBirdnetAnalyzer(() => {
    if (selectedFiles.length === 1 && !selectedFiles[0].toLowerCase().endsWith(".wav")) {
      return selectedFiles[0];
    }
    return null;
  });
  initFalseColorSpectrograms(() => {
    if (selectedFiles.length > 0) {
      const first = selectedFiles[0];
      const sep = first.includes("\\") ? "\\" : "/";
      const idx = first.lastIndexOf(sep);
      return idx > 0 ? first.slice(0, idx) : null;
    }
    return null;
  });

  try {
    const defaults = await invoke<IndexParams>("default_params");
    applyDefaults(defaults);
  } catch (e) {
    setStatus(t("analyze.loadParamsErr", { error: String(e) }), "error");
  }

  initDivBandEditors("sb-");
  initSpectrogramViewer({
    getFiles: () => selectedFiles,
    readParams: () => readParamsFromDom("sb-"),
    getIndices: selectedIndices,
  });

  await populateIndexCheckboxes();
  window.addEventListener("app-i18n", () => {
    void populateIndexCheckboxes();
    updateFileSummary();
  });
  syncProportionsDescFromParams();
  updateFileSummary();
}

init().catch((e) => {
  console.error(e);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = t("analyze.startupErr", { error: String(e) });
    status.className = "status error";
  }
});
