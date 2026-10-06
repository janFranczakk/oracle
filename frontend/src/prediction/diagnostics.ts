export type XY = [number, number];
export type IntervalScore = {
  objects_scored: number;
  coverage_x: number;
  coverage_y: number;
  coverage_xy: number;
  width_x_m: number;
  width_y_m: number;
  mean_error_m: number;
  spread_error_correlation: number | null;
};
export type Distribution = {
  method: 'mc_dropout_autoregressive_v1';
  samples: number;
  seed: number;
  dropout: number;
  quantiles: [number, number];
  nominal_marginal_coverage: number;
  calibrated: false;
  point_forecast: 'deterministic_eval';
  steps: { tick: number; objects: { id: string; mean: XY; std: XY; lower: XY; upper: XY }[] }[];
  measurement?: IntervalScore;
};
export type Attention = {
  method: 'anchor_object_attention_head_mean_v1';
  tick: number;
  object_ids: string[];
  weights: number[][];
  causal_explanation: false;
};
export type SamplingSettings = { samples: number; seed: string };
export function samplingOptions(enabled: boolean, settings: SamplingSettings) {
  if (!enabled || !settings.samples) return { samples: 0, sampling_seed: 7 };
  if (!/^\d+$/.test(settings.seed) || Number(settings.seed) > 2 ** 32 - 1)
    throw new Error('Sampling seed must be an integer from 0 to 4294967295.');
  return { samples: settings.samples, sampling_seed: Number(settings.seed) };
}
