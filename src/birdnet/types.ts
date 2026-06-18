/** Parsed BirdNET detection row (after import_birdnet). */
export interface BirdNetRow {
  filename: string;
  sensorId: string;
  date: string;
  time: string;
  datetime: Date;
  scientificName: string;
  commonName: string;
  confidence: number;
  order?: string;
  family?: string;
  species?: string;
  genus?: string;
  taxStatus?: string;
  start?: number;
  end?: number;
}

export interface BirdnetListRow {
  scientificName: string;
  commonName: string;
  nDays: number;
  nCalls: number;
  callRate: number;
  peakWeek: string;
  maxCallsDay: number;
  peakDay: string;
}

export interface CallDiversityMetrics {
  shannonDays: number;
  shannonCalls: number;
  simpsonDays: number;
  simpsonCalls: number;
  spRichness: number;
  evennessDays: number;
  evennessCalls: number;
}

export interface VocalHyperRow {
  taxon: string;
  detections: number;
  percentage: number;
  cumulative: number;
}

export type BirdnetVizType =
  | "list"
  | "histogram"
  | "calendar"
  | "pheno"
  | "top_species"
  | "diversity"
  | "hyperdominance"
  | "treemap";

export type PhenoSort =
  | "start"
  | "n.days"
  | "n.calls"
  | "call.rate"
  | "common.name"
  | "scientific.name";

export type HistGroupVar = "species" | "family" | "order";
