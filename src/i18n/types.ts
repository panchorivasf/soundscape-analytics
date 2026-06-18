export type Language = "en" | "es" | "fr" | "pt" | "de";

export type FontSize = "normal" | "large" | "xlarge";

export interface LocaleDict {
  [key: string]: string | LocaleDict;
}

export const LANGUAGES: { code: Language; labelKey: string }[] = [
  { code: "en", labelKey: "lang.en" },
  { code: "es", labelKey: "lang.es" },
  { code: "fr", labelKey: "lang.fr" },
  { code: "pt", labelKey: "lang.pt" },
  { code: "de", labelKey: "lang.de" },
];

export const FONT_SIZES: { id: FontSize; scale: number; labelKey: string }[] = [
  { id: "normal", scale: 1, labelKey: "settings.font.normal" },
  { id: "large", scale: 1.15, labelKey: "settings.font.large" },
  { id: "xlarge", scale: 1.3, labelKey: "settings.font.xlarge" },
];
