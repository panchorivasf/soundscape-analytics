import { t } from "./i18n";

/** Display names for indices: full title followed by acronym. */
export const INDEX_ANALYZE_LABELS: Record<string, string> = {
  aci: "Acoustic Complexity Index (ACI)",
  adi: "Acoustic Diversity Index (ADI)",
  aei: "Acoustic Evenness Index (AEI)",
  bi: "Bioacoustic Index (BI)",
  ndsi: "Normalized Difference Soundscape Index (NDSI)",
  fadi: "Frequency-dependent ADI (FADI)",
  fci: "Frequency Coverage Indices (FCI)",
  nbai: "Narrow-Band Acoustic Index (NBAI)",
  bbai: "Broad-Band Acoustic Index (BBAI)",
  tai: "Trill Activity Index (TAI)",
};

export function indexAnalyzeLabel(id: string): string {
  const key = `index.${id}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return INDEX_ANALYZE_LABELS[id] ?? id.toUpperCase();
}
