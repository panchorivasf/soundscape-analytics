/** Indices implemented in the backend but hidden from the app UI (re-enable here). */
export const UI_HIDDEN_INDICES = new Set<string>(["nbai", "tai"]);

export function isIndexUiVisible(id: string): boolean {
  return !UI_HIDDEN_INDICES.has(id);
}

export function filterVisibleIndices(ids: string[]): string[] {
  return ids.filter(isIndexUiVisible);
}
