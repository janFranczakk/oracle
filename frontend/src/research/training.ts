import { request } from '../api/client';
import { suiteNames } from './dataset';
import type { Suite } from './dataset';

export type Family = 'mlp' | 'gru';
export type TrainConfig = {
  model: { family: Family; history: number; embedding: number; hidden: number };
  epochs: number;
  seed: number;
  batch_size: number;
  learning_rate: number;
  contact_weight: number;
  threads: number;
  device: 'cpu' | 'cuda';
  horizons: number[];
};
export type Run = {
  id: string;
  status: 'running' | 'complete' | 'failed';
  phase: string;
  epoch: number;
  epochs: number;
  family: Family;
  seed: number;
  device: string;
  history: number;
  dataset_id?: string;
  created_at: string;
  parameters?: number;
  best_epoch?: number;
  best_validation_loss?: number;
  elapsed_seconds?: number;
  evaluation_completed?: number;
  evaluation_total?: number;
  error?: string;
};
export type Epoch = {
  epoch: number;
  train_loss: number;
  validation_loss: number;
  epoch_seconds: number;
};
export type Score = {
  objects_scored: number;
  position_mse: number;
  velocity_mse: number;
  rotation_mae_rad: number;
  displacement_m: number;
  contact_accuracy: number;
  contact_balanced_accuracy: number | null;
  contact_precision: number | null;
  contact_recall: number | null;
  contact_counts: { tp: number; tn: number; fp: number; fn: number };
};
export type Rollout = Score & { horizon: number; seconds: number; ade_m: number; fde_m: number };
export type Group = {
  episodes: number;
  windows: number;
  sample_dt: number;
  omitted_horizons: number[];
  anchors: { episode_id: string; seed: number; sample: number }[];
  one_step: { learned: Score; constant_velocity: Score };
  rollout: { learned: Rollout[]; constant_velocity: Rollout[] };
};
export type Identity = {
  id: string;
  content_sha256: string;
  normalization_sha256: string;
  sample_stride: number;
  sample_dt: number;
  gravity: number[];
};
export type RunDetail = {
  summary: Run;
  config: { config: TrainConfig; dataset: Identity | null };
  metrics: { epochs: Epoch[] } | null;
  evaluation: {
    groups: Record<string, Group>;
    selected_epoch: number;
    model_version: string;
    protocol: string;
  } | null;
  checkpoint: {
    sha256: string;
    epoch: number;
    parameters: number;
    runtime: { torch: string; python: string; platform: string; device: string };
    dataset: Identity;
  } | null;
};
export const trainingApi = {
  catalog: () => request<{ runs: Run[]; torch_available: boolean }>('/training/runs'),
  detail: (id: string) => request<RunDetail>(`/training/runs/${id}`),
  start: (dataset_id: string, config: TrainConfig) =>
    request<Run>('/training/jobs', { dataset_id, config }),
};
export function trainingConfig(
  family: Family,
  epochs: string,
  seed: string,
  history: string,
): TrainConfig {
  const integer = (value: string, max: number, min: number) =>
    /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
  if (!integer(epochs, 120, 1)) throw new Error('Choose 1–120 training epochs.');
  if (!integer(seed, 2 ** 32 - 1, 0))
    throw new Error('Choose an integer seed from 0 to 4294967295.');
  if (!integer(history, 8, 1)) throw new Error('Choose 1–8 observed history frames.');
  return {
    model: { family, history: Number(history), embedding: 64, hidden: 64 },
    epochs: Number(epochs),
    seed: Number(seed),
    batch_size: 64,
    learning_rate: 0.001,
    contact_weight: 0.1,
    threads: 2,
    device: 'cpu',
    horizons: [1, 5, 10, 20, 50],
  };
}
export function measured(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value !== 0 && Math.abs(value) < 0.001 ? value.toExponential(2) : value.toFixed(4);
}
export function groupName(key: string): string {
  return key.startsWith('ood/')
    ? `OOD · ${suiteNames[key.slice(4) as Suite] ?? key.slice(4)}`
    : key === 'test'
      ? 'Held-out test'
      : 'Validation';
}
export function rolloutChart(group: Group) {
  return group.rollout.learned.map((score) => ({
    horizon: score.horizon,
    learned: score.fde_m,
    baseline:
      group.rollout.constant_velocity.find((r) => r.horizon === score.horizon)?.fde_m ?? null,
  }));
}
