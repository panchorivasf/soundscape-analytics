/** Tracks produced tables/plots that have not been downloaded yet. */

export type UnsavedArtifact =
  | "analyze-results"
  | "index-plot"
  | "birdnet-table"
  | "birdnet-plot";

const dirty = new Set<UnsavedArtifact>();

const LABEL_KEYS: Record<UnsavedArtifact, string> = {
  "analyze-results": "exit.unsavedAnalyzeResults",
  "index-plot": "exit.unsavedIndexPlot",
  "birdnet-table": "exit.unsavedBirdnetTable",
  "birdnet-plot": "exit.unsavedBirdnetPlot",
};

export function markUnsaved(id: UnsavedArtifact): void {
  dirty.add(id);
}

export function markSaved(id: UnsavedArtifact): void {
  dirty.delete(id);
}

export function clearUnsaved(id: UnsavedArtifact): void {
  dirty.delete(id);
}

export function clearAllUnsaved(): void {
  dirty.clear();
}

export function hasUnsavedWork(): boolean {
  return dirty.size > 0;
}

export function getUnsavedArtifacts(): UnsavedArtifact[] {
  return [...dirty];
}

export function getUnsavedLabelKeys(): string[] {
  return getUnsavedArtifacts().map((id) => LABEL_KEYS[id]);
}
