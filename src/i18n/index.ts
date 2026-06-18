import de from "./locales/de";
import en from "./locales/en";
import es from "./locales/es";
import fr from "./locales/fr";
import pt from "./locales/pt";
import type { FontSize, Language, LocaleDict } from "./types";
import { FONT_SIZES, LANGUAGES } from "./types";

export type { FontSize, Language } from "./types";
export { FONT_SIZES, LANGUAGES } from "./types";

const LANG_KEY = "soundecology.lang";
const FONT_KEY = "soundecology.fontSize";

const LOCALES: Record<Language, LocaleDict> = { en, es, fr, pt, de };

let currentLang: Language = "en";

function getNested(obj: LocaleDict, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || !(part in (cur as object))) return undefined;
    cur = (cur as LocaleDict)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Translate a dot-key; supports `{name}` placeholders. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let text =
    getNested(LOCALES[currentLang], key) ??
    getNested(en, key) ??
    key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

export function getLanguage(): Language {
  return currentLang;
}

export function getFontSize(): FontSize {
  const v = localStorage.getItem(FONT_KEY);
  if (v === "large" || v === "xlarge" || v === "normal") return v;
  return "normal";
}

function applyFontScale(size: FontSize): void {
  const entry = FONT_SIZES.find((f) => f.id === size) ?? FONT_SIZES[0];
  document.documentElement.style.setProperty("--font-scale", String(entry.scale));
}

const TAB_KEYS: Record<string, string> = {
  analyze: "tab.analyze",
  "birdnet-analyzer": "tab.birdnetAnalyzer",
  falsecolor: "tab.falsecolor",
  birdnet: "tab.birdnet",
  plots: "tab.plots",
  sandbox: "tab.sandbox",
  guide: "tab.guide",
};

const ID_TEXT_KEYS: Record<string, string> = {
  "pick-files": "toolbar.pickFiles",
  "pick-folder": "toolbar.pickFolder",
  "clear-files": "toolbar.clearFiles",
  "menu-file": "menu.file",
  "menu-options": "menu.options",
  "menu-about": "menu.about",
  compute: "analyze.compute",
  "div-bands-equalize": "analyze.resetBands",
  "analyze-export-table": "export.download",
  "bn-export-table": "export.download",
};

const SELECTOR_TEXT: [string, string][] = [];

const LABEL_KEYS: Record<string, string> = {
  "freq-res": "analyze.freqRes",
  "win-fun": "analyze.window",
  cutoff: "analyze.cutoff",
  "n-bands": "analyze.nBands",
  "w-len": "analyze.fftWindow",
  "num-threads": "analyze.threads",
  "channel-mode": "analyze.stereoMono",
  "rm-offset": "analyze.rmOffset",
  "aci-min-freq": "analyze.minFreq",
  "aci-max-freq": "analyze.maxFreq",
  "bi-min-freq": "analyze.minFreq",
  "bi-max-freq": "analyze.maxFreq",
};

const TABLE_HEADER_KEYS = [
  "analyze.colFile",
  "analyze.colIndex",
  "analyze.colValue",
  "analyze.colL",
  "analyze.colR",
  "analyze.colAvg",
  "analyze.colDuration",
];

function applyLabelTranslations(): void {
  for (const [inputId, key] of Object.entries(LABEL_KEYS)) {
    const input = document.getElementById(inputId);
    const label = input?.closest("label");
    if (!label) continue;
    const text = t(key);
    if (inputId === "rm-offset") {
      label.childNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) n.textContent = ` ${text}`;
      });
      continue;
    }
    const nodes = [...label.childNodes];
    const firstText = nodes.find((n) => n.nodeType === Node.TEXT_NODE);
    if (firstText) {
      firstText.textContent = `${text} `;
    } else if (input && label.firstChild === input) {
      label.insertBefore(document.createTextNode(`${text} `), input);
    }
  }

  const channelMode = document.getElementById("channel-mode") as HTMLSelectElement | null;
  if (channelMode) {
    const opts = ["mix", "each", "left", "right"] as const;
    const keys = [
      "analyze.channelMix",
      "analyze.channelEach",
      "analyze.channelLeft",
      "analyze.channelRight",
    ] as const;
    opts.forEach((val, i) => {
      const opt = channelMode.querySelector(`option[value="${val}"]`);
      if (opt) opt.textContent = t(keys[i]);
    });
  }
}

function applyTableHeaders(): void {
  const headers = document.querySelectorAll<HTMLTableCellElement>(
    "#results-table thead th"
  );
  headers.forEach((th, i) => {
    const key = TABLE_HEADER_KEYS[i];
    if (key) th.textContent = t(key);
  });
}

export function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    const key = el.dataset.i18nTitle;
    if (key) el.title = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    const key = el.dataset.i18nPlaceholder;
    if (key && "placeholder" in el) (el as HTMLInputElement).placeholder = t(key);
  });

  document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  });

  for (const [id, key] of Object.entries(ID_TEXT_KEYS)) {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  }

  document.querySelectorAll<HTMLButtonElement>(".main-tab").forEach((tab) => {
    const key = TAB_KEYS[tab.dataset.tab ?? ""];
    if (key) tab.textContent = t(key);
  });

  for (const [sel, key] of SELECTOR_TEXT) {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key);
  }

  applyLabelTranslations();
  applyTableHeaders();

  const appIcon = document.getElementById("app-icon") as HTMLImageElement | null;
  if (appIcon) appIcon.alt = t("app.title");

  const museoLogo = document.getElementById("museo-logo") as HTMLImageElement | null;
  if (museoLogo) museoLogo.alt = t("toolbar.museoLogo");

  const labLogo = document.getElementById("lab-logo") as HTMLImageElement | null;
  if (labLogo) labLogo.alt = t("toolbar.labLogo");

  const aboutClose = document.getElementById("about-close");
  if (aboutClose) aboutClose.setAttribute("aria-label", t("about.close"));

  document.title = t("app.title");

  populateSettingsSelectLabels();
}

function populateSettingsSelectLabels(): void {
  const langSel = document.getElementById("app-language") as HTMLSelectElement | null;
  if (langSel) {
    langSel.querySelectorAll("option").forEach((opt) => {
      const code = opt.value as Language;
      const entry = LANGUAGES.find((l) => l.code === code);
      if (entry) opt.textContent = t(entry.labelKey);
    });
  }
  const fontSel = document.getElementById("app-font-size") as HTMLSelectElement | null;
  if (fontSel) {
    fontSel.querySelectorAll("option").forEach((opt) => {
      const id = opt.value as FontSize;
      const entry = FONT_SIZES.find((f) => f.id === id);
      if (entry) opt.textContent = t(entry.labelKey);
    });
  }
  const langLabel = document.querySelector("[data-i18n='settings.language']");
  const fontLabel = document.querySelector("[data-i18n='settings.fontSize']");
  if (langLabel) langLabel.textContent = t("settings.language");
  if (fontLabel) fontLabel.textContent = t("settings.fontSize");
}

export function setLanguage(lang: Language): void {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  applyTranslations();
  window.dispatchEvent(new CustomEvent("app-i18n"));
}

export function setFontSize(size: FontSize): void {
  localStorage.setItem(FONT_KEY, size);
  applyFontScale(size);
}

export function initI18n(): void {
  const saved = localStorage.getItem(LANG_KEY) as Language | null;
  if (saved && saved in LOCALES) currentLang = saved;
  else currentLang = "en";

  document.documentElement.lang = currentLang;
  applyFontScale(getFontSize());
  applyTranslations();

  const langSel = document.getElementById("app-language") as HTMLSelectElement | null;
  const fontSel = document.getElementById("app-font-size") as HTMLSelectElement | null;

  if (langSel) {
    langSel.value = currentLang;
    langSel.addEventListener("change", () => {
      setLanguage(langSel.value as Language);
    });
  }

  if (fontSel) {
    fontSel.value = getFontSize();
    fontSel.addEventListener("change", () => {
      setFontSize(fontSel.value as FontSize);
    });
  }
}
