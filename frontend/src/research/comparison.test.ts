import { describe, expect, it } from 'vitest';
import { comparisonChart, comparisonConfig, comparisonCsv, oodMean } from './comparison';
import type { ComparisonModel, ComparisonReport } from './comparison';
import type { Group, Score } from './training';

const score: Score = {
  objects_scored: 2,
  position_mse: 0.2,
  velocity_mse: 0.3,
  rotation_mae_rad: 0.4,
  displacement_m: 1,
  contact_accuracy: 0.8,
  contact_balanced_accuracy: null,
  contact_precision: null,
  contact_recall: null,
  contact_counts: { tp: 0, tn: 2, fp: 0, fn: 0 },
};
function group(error: number, count = 2): Group {
  return {
    episodes: 1,
    windows: 10,
    sample_dt: 1 / 30,
    omitted_horizons: [50],
    anchors: [{ episode_id: 'fixture', seed: 7, sample: 2 }],
    one_step: { learned: score, constant_velocity: score },
    rollout: {
      learned: [
        {
          ...score,
          objects_scored: count,
          horizon: 10,
          seconds: 1 / 3,
          ade_m: error / 2,
          fde_m: error,
        },
      ],
      constant_velocity: [{ ...score, horizon: 10, seconds: 1 / 3, ade_m: 3, fde_m: 6 }],
    },
  };
}
function model(id: string): ComparisonModel {
  return {
    id,
    label: '',
    checkpoint_sha256: 'c'.repeat(64),
    architecture: { family: 'mlp', history: 3, embedding: 16, hidden: 16 },
    parameters: 100,
    selected_epoch: 1,
    training_seed: 7,
    bytes: 400,
    groups: {
      test: group(2),
      'ood/unseen_mass': group(4, 100),
      'ood/unseen_velocity': group(8, 1),
    },
    latency: {
      group: 'test',
      scope: 'warmed_cpu_forward_only',
      median_ms: 0.5,
      p95_ms: 0.8,
      batch_size: 1,
      warmup: 3,
      repetitions: 10,
      episode_id: 'fixture',
      anchor: 2,
      objects: 5,
    },
  };
}
function report(): ComparisonReport {
  return {
    protocol: 'oracle-research-comparison-v1',
    id: 'fixture-batch',
    created_at: 'fixture',
    source: 'learned_model',
    point_forecast: 'deterministic_eval',
    dataset: {
      id: 'ds-' + '0'.repeat(16),
      content_sha256: 'a'.repeat(64),
      normalization_sha256: 'b'.repeat(64),
      sample_stride: 4,
      sample_dt: 1 / 30,
      gravity: [0, -9.81],
    },
    request: comparisonConfig('ds-' + '0'.repeat(16), ['first', 'second'], '1, 10, 50', ['test']),
    common_history: 3,
    schedule_sha256: {
      test: 'd'.repeat(64),
      'ood/unseen_mass': 'e'.repeat(64),
      'ood/unseen_velocity': 'f'.repeat(64),
    },
    runtime: {
      torch: 'fixture',
      python: 'fixture',
      platform: 'fixture',
      device: 'cpu',
      threads: 2,
    },
    models: [model('first'), model('second')],
    elapsed_seconds: 1,
  };
}
describe('matched research configuration and summaries', () => {
  it('keeps named groups separate and sorts bounded distinct horizons', () => {
    const result = comparisonConfig('dataset', ['mlp', 'gru'], '50, 1, 10', [
      'test',
      'ood/unseen_mass',
    ]);
    expect(result.horizons).toEqual([1, 10, 50]);
    expect(result.groups).toEqual(['test', 'ood/unseen_mass']);
  });
  it.each(['', '0', '121', '1,1', '1.5', '1,'])('rejects an invalid horizon list %s', (value) => {
    expect(() => comparisonConfig('dataset', ['mlp', 'gru'], value, ['test'])).toThrow();
  });
  it('rejects duplicate models and training data as comparison inputs', () => {
    expect(() => comparisonConfig('dataset', ['mlp', 'mlp'], '1', ['test'])).toThrow();
    expect(() => comparisonConfig('dataset', ['mlp', 'gru'], '1', ['train'])).toThrow();
  });
  it('reports an unweighted suite mean and leaves unavailable horizons null', () => {
    expect(oodMean(model('m'), 10)).toBe(6);
    expect(oodMean(model('m'), 50)).toBeNull();
  });
  it('charts actual returned horizons alongside the common reference without filling gaps', () => {
    expect(comparisonChart(report(), 'test')).toEqual([
      { horizon: 10, reference: 3, model0: 1, model1: 1 },
    ]);
  });
  it('exports measured rows with checkpoint/sample provenance and escapes spreadsheet formulas', () => {
    const value = report();
    value.models[0].label = ' =SUM(1,2)';
    const csv = comparisonCsv(value);
    expect(csv).toContain('"\' =SUM(1,2)"');
    expect(csv).toContain('"' + value.models[0].checkpoint_sha256 + '"');
    expect(csv).toContain('"' + value.schedule_sha256.test + '"');
    expect(csv.split('\r\n')).toHaveLength(7);
  });
});
