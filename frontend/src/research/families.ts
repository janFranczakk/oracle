import { request } from '../api/client';
import type { Identity } from './training';

export type SampleStatistics = {
  n: number;
  missing: number;
  mean: number | null;
  std: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  mean_ci95: [number, number] | null;
};
export type FamilyMetric = {
  group: string;
  scope: 'one_step' | 'rollout';
  horizon: number;
  metric: string;
  statistics: SampleStatistics;
};
export type SeedStudy = {
  format: 'oracle-multiseed-v1';
  id: string;
  provenance: {
    dataset: Identity;
    confidence_method: string;
    selection: string;
    std_method: string;
  };
  interpretation: string;
  schedule_sha256: Record<string, string>;
  config: { seeds: number[]; training: { epochs: number; model: { history: number } } };
  families: {
    family: string;
    seeds: number[];
    metrics: FamilyMetric[];
    runs: {
      id: string;
      seed: number;
      checkpoint_sha256: string;
      selected_epoch: number;
      best_validation: number;
    }[];
  }[];
};
export type StudySummary = {
  id: string;
  dataset_id: string;
  families: string[];
  seeds: number[];
  elapsed_seconds: number;
};
export const familyApi = {
  catalog: () => request<{ studies: StudySummary[] }>('/research/families'),
  detail: (id: string) => request<SeedStudy>(`/research/families/${id}`),
};
export function familyMetric(
  study: SeedStudy['families'][number],
  group: string,
  scope: FamilyMetric['scope'],
  horizon: number,
  metric: string,
) {
  return study.metrics.find(
    (r) => r.group === group && r.scope === scope && r.horizon === horizon && r.metric === metric,
  )?.statistics;
}
export function meanSpread(stats: SampleStatistics | undefined, digits = 3) {
  if (stats?.mean == null) return '—';
  return `${stats.mean.toFixed(digits)} ± ${stats.std == null ? '—' : stats.std.toFixed(digits)}`;
}
