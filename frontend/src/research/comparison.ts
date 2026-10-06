import { request } from '../api/client';
import type { ModelDescription } from '../prediction/types';
import type { CatalogItem } from './dataset';
import type { Group, Identity } from './training';

export const researchGroups = [
  'test',
  'ood/unseen_mass',
  'ood/unseen_velocity',
  'ood/unseen_angle',
  'ood/unseen_object_count',
  'ood/unseen_obstacles',
  'ood/held_out_combination',
];
export type Checkpoint = ModelDescription & {
  label: string;
  pinned: boolean;
  archived: boolean;
  parameters: number;
  training_seed: number;
  bytes: number;
};
export type Notes = Pick<Checkpoint, 'label' | 'pinned' | 'archived'>;
export type BatchConfig = {
  dataset_id: string;
  models: string[];
  horizons: number[];
  groups: string[];
  threads: number;
};
export type BatchSummary = {
  id: string;
  status: 'running' | 'complete' | 'failed';
  phase: string;
  completed: number;
  total: number;
  dataset_id: string;
  created_at?: string;
  model_id?: string;
  group?: string;
  error?: string;
  elapsed_seconds?: number;
};
export type ComparisonModel = {
  id: string;
  label: string;
  checkpoint_sha256: string;
  architecture: ModelDescription['architecture'];
  parameters: number;
  selected_epoch: number;
  training_seed: number;
  bytes: number;
  groups: Record<string, Group>;
  latency: {
    group: string;
    scope: string;
    median_ms: number;
    p95_ms: number;
    batch_size: number;
    warmup: number;
    repetitions: number;
    episode_id: string;
    anchor: number;
    objects: number;
  };
};
export type ComparisonReport = {
  protocol: 'oracle-research-comparison-v1';
  id: string;
  created_at: string;
  source: 'learned_model';
  point_forecast: 'deterministic_eval';
  dataset: Identity;
  request: BatchConfig;
  common_history: number;
  schedule_sha256: Record<string, string>;
  runtime: { torch: string; python: string; platform: string; device: string; threads: number };
  models: ComparisonModel[];
  elapsed_seconds: number;
};
export type BatchDetail = { summary: BatchSummary; report: ComparisonReport | null };
export const researchApi = {
  checkpoints: () =>
    request<{ models: Checkpoint[]; unavailable: string[]; torch_available: boolean }>(
      '/research/checkpoints',
    ),
  notes: (id: string, notes: Notes) =>
    request<Notes & { id: string }>(`/research/checkpoints/${id}/notes`, notes),
  batches: () => request<{ batches: BatchSummary[] }>('/research/batches'),
  detail: (id: string) => request<BatchDetail>(`/research/batches/${id}`),
  start: (config: BatchConfig) => request<BatchSummary>('/research/jobs', config),
};
export function compatibleCheckpoint(model: Checkpoint, dataset: CatalogItem | undefined) {
  return (
    !!dataset &&
    model.dataset_id === dataset.id &&
    model.dataset_sha256 === dataset.content_sha256 &&
    model.normalization_sha256 === dataset.normalization_sha256
  );
}
export function comparisonConfig(
  dataset_id: string,
  models: string[],
  horizons: string,
  groups: string[],
): BatchConfig {
  const pieces = horizons.split(',').map((p) => p.trim());
  const values = pieces.map(Number);
  if (
    pieces.some((p) => !/^\d+$/.test(p)) ||
    values.some((n) => n < 1 || n > 120) ||
    new Set(values).size !== values.length ||
    values.length > 8
  )
    throw new Error('Choose up to eight distinct horizons from 1 to 120, separated by commas.');
  if (models.length < 2 || models.length > 4 || new Set(models).size !== models.length)
    throw new Error('Select 2–4 distinct compatible checkpoints.');
  if (
    !groups.length ||
    new Set(groups).size !== groups.length ||
    groups.some((g) => !researchGroups.includes(g))
  )
    throw new Error('Select at least one test or OOD group.');
  return { dataset_id, models, horizons: values.sort((a, b) => a - b), groups, threads: 2 };
}
export function comparisonChart(report: ComparisonReport, group: string) {
  const first = report.models[0]?.groups[group];
  return (first?.rollout.constant_velocity || []).map((row) => {
    const point: Record<string, number> = { horizon: row.horizon, reference: row.ade_m };
    report.models.forEach((model, i) => {
      const score = model.groups[group]?.rollout.learned.find((s) => s.horizon === row.horizon);
      if (score) point[`model${i}`] = score.ade_m;
    });
    return point;
  });
}
export function oodMean(model: ComparisonModel, horizon: number): number | null {
  const values = Object.entries(model.groups)
    .filter(([key]) => key.startsWith('ood/'))
    .map(([, group]) => group.rollout.learned.find((r) => r.horizon === horizon)?.fde_m)
    .filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function csvCell(value: string | number) {
  const text =
    typeof value === 'string' && /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
export function comparisonCsv(report: ComparisonReport) {
  const rows: (string | number)[][] = [
    [
      'batch',
      'dataset_sha256',
      'model',
      'label',
      'family',
      'checkpoint_sha256',
      'history',
      'parameters',
      'epoch',
      'training_seed',
      'group',
      'horizon',
      'objects',
      'ade_m',
      'fde_m',
      'cv_ade_m',
      'cv_fde_m',
      'position_mse',
      'velocity_mse',
      'rotation_mae_rad',
      'contact_balanced_accuracy',
      'forward_median_ms',
      'forward_p95_ms',
      'schedule_sha256',
    ],
  ];
  for (const model of report.models)
    for (const [key, group] of Object.entries(model.groups))
      for (const row of group.rollout.learned)
        rows.push([
          report.id,
          report.dataset.content_sha256,
          model.id,
          model.label,
          model.architecture.family,
          model.checkpoint_sha256,
          model.architecture.history,
          model.parameters,
          model.selected_epoch,
          model.training_seed,
          key,
          row.horizon,
          row.objects_scored,
          row.ade_m,
          row.fde_m,
          group.rollout.constant_velocity.find((r) => r.horizon === row.horizon)?.ade_m ?? '',
          group.rollout.constant_velocity.find((r) => r.horizon === row.horizon)?.fde_m ?? '',
          row.position_mse,
          row.velocity_mse,
          row.rotation_mae_rad,
          row.contact_balanced_accuracy ?? '',
          model.latency.median_ms,
          model.latency.p95_ms,
          report.schedule_sha256[key],
        ]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
