import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AUDIO_DIALOG_FILTER,
  isFolderSelection,
} from "./audioFormats";
import type { TableExportData } from "./exportData";
import { wireTableExportBar } from "./exportData";
import { markUnsaved } from "./unsavedWork";
import { initExitGuard } from "./exitGuard";
import { initBirdnetAnalyzer } from "./birdnetAnalyzer";
import { initBirdnetViewer } from "./birdnetViewer";
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
let syncAnalyzeExportDisabled: () => void = () => {};

const $ = (id: string) => document.getElementById(id)!;

function indexResultsToTable(results: IndexResult[]): TableExportData {
  const num = (v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? "" : v.toFixed(6);
  return {
    columns: [
      "file_name",
      "index",
      "value",
      "value_l",
      "value_r",
      "value_avg",
      "channels",
      "duration",
      "sample_rate",
      "error",
    ],
    rows: results.map((r) => [
      r.fileName,
      r.index,
      num(r.value ?? r.valueAvg),
      num(r.valueL),
      num(r.valueR),
      num(r.valueAvg),
      r.channels,
      r.duration.toFixed(6),
      String(r.sampleRate),
      r.error ?? "",
    ]),
    defaultBaseName: "soundscape_analytics_results",
  };
}

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
  if (isFolderSelection(selectedFiles)) {
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

function closeAllMenus(): void {
  document.querySelectorAll<HTMLElement>(".menu-dropdown").forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll<HTMLButtonElement>(".menu-trigger[aria-expanded]").forEach((btn) => {
    btn.setAttribute("aria-expanded", "false");
  });
}

function toggleMenu(triggerId: string, dropdownId: string): void {
  const trigger = $(triggerId);
  const dropdown = $(dropdownId);
  const isOpen = !dropdown.hidden;
  closeAllMenus();
  if (!isOpen) {
    dropdown.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }
}

function openAboutModal(): void {
  closeAllMenus();
  const modal = $("about-modal");
  modal.hidden = false;
}

function closeAboutModal(): void {
  $("about-modal").hidden = true;
}

function wireMenubar(): void {
  $("menu-file").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu("menu-file", "menu-file-dropdown");
  });

  $("menu-options").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu("menu-options", "menu-options-dropdown");
  });

  $("menu-about").addEventListener("click", () => {
    openAboutModal();
  });

  $("about-close").addEventListener("click", () => closeAboutModal());
  $("about-backdrop").addEventListener("click", () => closeAboutModal());

  document.addEventListener("click", () => closeAllMenus());
  document.querySelectorAll(".menu-dropdown").forEach((menu) => {
    menu.addEventListener("click", (e) => e.stopPropagation());
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllMenus();
      closeAboutModal();
    }
  });
}

function wireUiHandlers(): void {
  $("pick-files").addEventListener("click", async () => {
    closeAllMenus();
    const picked = await open({
      multiple: true,
      filters: [AUDIO_DIALOG_FILTER],
    });
    if (picked) {
      selectedFiles = Array.isArray(picked) ? picked : [picked];
      updateFileSummary();
    }
  });

  $("pick-folder").addEventListener("click", async () => {
    closeAllMenus();
    const folder = await open({ directory: true, multiple: false });
    if (folder && typeof folder === "string") {
      selectedFiles = [folder];
      updateFileSummary();
      setStatus(t("analyze.folderSelected"));
    }
  });

  $("clear-files").addEventListener("click", () => {
    closeAllMenus();
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
      markUnsaved("analyze-results");
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      setStatus(t("analyze.done", { count: results.length, time: elapsed }), "ok");
      syncAnalyzeExportDisabled();
    } catch (e) {
      setStatus(String(e), "error");
    } finally {
      $("compute").removeAttribute("disabled");
    }
  });

  syncAnalyzeExportDisabled = wireTableExportBar(
    "analyze-export-bar",
    () => (lastResults.length > 0 ? indexResultsToTable(lastResults) : null),
    setStatus,
    () => lastResults.length === 0,
    "analyze-results"
  );

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
  wireMenubar();
  wireUiHandlers();
  await initExitGuard();

  initDivBandEditors("");
  initPlots(() => lastResults);
  initBirdnetViewer();
  initBirdnetAnalyzer(() => {
    if (isFolderSelection(selectedFiles)) {
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
