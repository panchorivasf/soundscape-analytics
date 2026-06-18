/** Supported audio file extensions for index computation and file dialogs. */
export const AUDIO_EXTENSIONS = [
  "wav",
  "flac",
  "mp3",
  "ogg",
  "oga",
  "m4a",
  "aac",
  "aiff",
  "aif",
  "wma",
] as const;

export function audioExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

export function isAudioFile(path: string): boolean {
  return AUDIO_EXTENSIONS.includes(audioExtension(path) as (typeof AUDIO_EXTENSIONS)[number]);
}

export function isFolderSelection(paths: string[]): boolean {
  return paths.length === 1 && !isAudioFile(paths[0]);
}

export const AUDIO_DIALOG_FILTER = {
  name: "Audio",
  extensions: [...AUDIO_EXTENSIONS],
};
