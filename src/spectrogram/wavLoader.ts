import { convertFileSrc } from "@tauri-apps/api/core";

export interface WavLoadResult {
  sampleRate: number;
  duration: number;
  stereo: boolean;
  left: Float32Array;
  right: Float32Array | null;
}

export async function loadWav(filePath: string): Promise<WavLoadResult> {
  const resp = await fetch(convertFileSrc(filePath));
  const buf = await resp.arrayBuffer();
  const ctx = new AudioContext();
  const audio = await ctx.decodeAudioData(buf.slice(0));
  await ctx.close();

  const sr = audio.sampleRate;
  const n = audio.length;
  const left = audio.getChannelData(0).slice();
  const right =
    audio.numberOfChannels > 1 ? audio.getChannelData(1).slice() : null;

  return {
    sampleRate: sr,
    duration: n / sr,
    stereo: audio.numberOfChannels > 1,
    left,
    right,
  };
}

function mixStereo(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2;
  return out;
}

/** Resolve channel mode to one or two sample streams for the sandbox spectrogram. */
export function resolveChannelSamples(
  wav: WavLoadResult,
  channelMode: string
): { primary: Float32Array; secondary: Float32Array | null; stereoEach: boolean } {
  if (!wav.stereo || channelMode === "left") {
    return { primary: wav.left, secondary: null, stereoEach: false };
  }
  if (channelMode === "right" && wav.right) {
    return { primary: wav.right, secondary: null, stereoEach: false };
  }
  if ((channelMode === "mix" || channelMode === "average") && wav.right) {
    return { primary: mixStereo(wav.left, wav.right), secondary: null, stereoEach: false };
  }
  if (channelMode === "each" && wav.right) {
    return { primary: wav.left, secondary: wav.right, stereoEach: true };
  }
  return { primary: wav.left, secondary: null, stereoEach: false };
}

/** @deprecated Use loadWav + resolveChannelSamples */
export async function loadWavMono(
  filePath: string,
  channelMode: string
): Promise<{ samples: Float32Array; sampleRate: number; duration: number }> {
  const wav = await loadWav(filePath);
  const { primary } = resolveChannelSamples(wav, channelMode);
  return { samples: primary, sampleRate: wav.sampleRate, duration: wav.duration };
}
