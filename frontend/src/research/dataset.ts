import { request } from '../api/client';
import type { Frame, WorldState } from '../types';

export type Split = 'train' | 'validation' | 'test' | 'ood';
export type Suite =
  | 'in_distribution'
  | 'unseen_mass'
  | 'unseen_velocity'
  | 'unseen_angle'
  | 'unseen_object_count'
  | 'unseen_obstacles'
  | 'held_out_combination';
export const splits: Split[] = ['train', 'validation', 'test', 'ood'];
export const suiteNames: Record<Suite, string> = {
  in_distribution: 'In distribution',
  unseen_mass: 'Unseen mass',
  unseen_velocity: 'Unseen velocity',
  unseen_angle: 'Unseen angle',
  unseen_object_count: 'Unseen object count',
  unseen_obstacles: 'Unseen obstacles',
  held_out_combination: 'Held-out combination',
};
export type DatasetConfig = {
  seed: number;
  train: number;
  validation: number;
  test: number;
  ood_per_suite: number;
  steps: number;
  sample_stride: number;
};
export type EpisodeEntry = {
  id: string;
  seed: number;
  split: Split;
  suite: Suite;
  sha256: string;
  dynamic_objects: number;
  obstacles: number;
  samples: number;
  pairs: number;
  contacts: number;
  initial_masses: number[];
  initial_speeds: number[];
};
export type Normalization = {
  method: string;
  feature_names: string[];
  mean: number[];
  scale: number[];
  constant_features: string[];
  observations: number;
  source_episodes: Record<string, string>;
};
export type Manifest = {
  id: string;
  generator: string;
  engine: string;
  created_at: string;
  config: DatasetConfig;
  content_sha256: string;
  normalization_sha256: string;
  runtime: Record<string, string>;
  episodes: EpisodeEntry[];
};
export type CatalogItem = Omit<Manifest, 'episodes'> & {
  episode_count: number;
  pair_count: number;
};
export type DatasetDetail = { manifest: Manifest; normalization: Normalization };
export type EpisodePreview = {
  entry: EpisodeEntry;
  ranges: {
    mass: number[];
    speed: number[];
    angle_degrees: number[];
    object_count: number[];
    obstacle_count: number[];
  };
  environment: WorldState['environment'];
  frames: Frame[];
  preview_stride: number;
  checksum_verified: boolean;
};
export type CollectionJob = {
  id: string;
  status: 'running' | 'complete' | 'failed';
  phase: string;
  completed: number;
  total: number;
  dataset_id?: string;
  error?: string;
};
export const datasetApi = {
  catalog: () => request<{ datasets: CatalogItem[] }>('/datasets'),
  detail: (id: string) => request<DatasetDetail>(`/datasets/${id}`),
  episode: (id: string, eid: string) => request<EpisodePreview>(`/datasets/${id}/episodes/${eid}`),
  collect: (config: DatasetConfig) => request<CollectionJob>('/datasets/jobs', config),
  job: (id: string) => request<CollectionJob>(`/datasets/jobs/${id}`),
};

export function filterEpisodes(episodes: EpisodeEntry[], split: Split, suite: string) {
  return episodes.filter(
    (e) => e.split === split && (split !== 'ood' || suite === 'all' || e.suite === suite),
  );
}
export function histogram(values: number[], bins: number, min: number, max: number) {
  if (!Number.isInteger(bins) || bins < 1 || max <= min)
    throw new Error('Invalid histogram bounds');
  const counts = Array<number>(bins).fill(0);
  for (const value of values) {
    if (!Number.isFinite(value) || value < min || value > max) continue;
    counts[Math.min(bins - 1, Math.floor(((value - min) / (max - min)) * bins))]++;
  }
  return counts;
}
export function collectionConfig(seed: string, size: string, seconds: string): DatasetConfig {
  if (!/^\d+$/.test(seed) || Number(seed) > 2 ** 32 - 1)
    throw new Error('Choose an integer seed from 0 to 4294967295.');
  const sizes: Record<string, number[]> = {
    compact: [8, 2, 2, 1],
    standard: [24, 8, 8, 4],
    extended: [96, 24, 24, 12],
  };
  if (!sizes[size] || !['2', '4', '8'].includes(seconds))
    throw new Error('Choose a supported collection size and duration.');
  const [train, validation, test, ood_per_suite] = sizes[size];
  return {
    seed: Number(seed),
    train,
    validation,
    test,
    ood_per_suite,
    steps: Number(seconds) * 120,
    sample_stride: 4,
  };
}
