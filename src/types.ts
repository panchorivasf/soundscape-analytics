export interface BandRange {
  minHz: number;
  maxHz: number;
}

export interface IndexParams {
  freqRes: number;
  winFun: string;
  minFreq: number;
  maxFreq: number | null;
  cutoff: number;
  nBands: number;
  divBandRanges: BandRange[];
  wLen: number;
  rmOffset: boolean;
  noiseRed: number;
  normSpec: boolean;
  propDen: number;
  dbFs: boolean;
  anthroMin: number;
  anthroMax: number;
  bioMin: number;
  bioMax: number;
  j: number | null;
  aciMinFreq: number;
  aciMaxFreq: number | null;
  biMinFreq: number;
  biMaxFreq: number;
  hpf: number;
  activityCutoff: number;
  nWindows: number;
  clickLength: number;
  difference: number;
  gapAllowance: number;
  nem: number;
  fadiMinFreq: number;
  fadiMaxFreq: number;
  thresholdFixed: number;
  freqStep: number;
  gamma: number;
  lfMin: number;
  lfMax: number;
  mfMin: number;
  mfMax: number;
  hfMin: number;
  hfMax: number;
  ufMin: number;
  ufMax: number;
  /** Stereo handling: each | left | right | mix */
  channelMode: string;
}

export interface BandViz {
  label: string;
  minHz: number;
  maxHz: number;
  proportion: number;
}

export interface FciBandViz {
  label: string;
  minHz: number;
  maxHz: number;
  cover: number;
}

export interface SpectrogramViz {
  fileName: string;
  filePath: string;
  duration: number;
  sampleRate: number;
  cutoff: number;
  frequenciesHz: number[];
  timesSec: number[];
  dbMatrix: number[][];
  binaryMatrix: number[][];
  adiValue: number | null;
  aeiValue: number | null;
  adiBands: BandViz[] | null;
  aeiBands: BandViz[] | null;
  fciBands: FciBandViz[] | null;
  bbaiValue: number | null;
  bbaiClickMatrix: number[][] | null;
}

export interface IndexResult {
  fileName: string;
  index: string;
  value: number | null;
  valueL: number | null;
  valueR: number | null;
  valueAvg: number | null;
  channels: string;
  duration: number;
  sampleRate: number;
  error: string | null;
}

export interface EnrichedResult extends IndexResult {
  sensorId: string;
  datetime: Date | null;
  dateKey: string | null;
  weekKey: string | null;
  monthKey: string | null;
  hour: number | null;
  numericValue: number | null;
}
