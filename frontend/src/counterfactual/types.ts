import type { Body, Experiment, Frame } from '../types';
import type { ModelDescription, Prediction } from '../prediction/types';

export type Patch = Partial<Omit<Body, 'id' | 'label' | 'shape' | 'static'>>;
export type Change =
  | { kind: 'update'; object_id: string; patch: Patch }
  | { kind: 'remove'; object_id: string }
  | { kind: 'add'; object: Body };
export type Branch = { id: string; name: string; parent_id: string | null; changes: Change[] };
export type Plan = {
  format: 'oracle-counterfactual-plan-v1';
  id: string;
  snapshot: {
    created_at: string;
    source: { generation: string; anchor_tick: number; revision: number };
    experiment: Experiment;
    frame: Frame;
  };
  branches: Branch[];
};
export type Description = {
  plan: Plan;
  previews: Record<string, Frame>;
  fingerprints: Record<string, string>;
};
export type Comparison = {
  model_sha256: string;
  branch_sha256: string;
  metrics: Prediction['metrics'];
};
export type Future = {
  format: 'oracle-counterfactual-future-v1';
  source: 'learned_model' | 'pymunk-7.2.0';
  plan_id: string;
  branch_id: string;
  branch_sha256: string;
  created_at: string;
  anchor_frame: Frame;
  horizon: number;
  sample_stride: number;
  sample_dt: number;
  frames: Frame[];
  uncertainty: null;
  elapsed_seconds: number;
  model?: ModelDescription;
  model_version?: string;
  conditioning?: {
    method: 'terminal_state_override_v1';
    added_ids: string[];
    removed_ids: string[];
    added_history: string | null;
    removed_history: string | null;
    intervention_trained: false;
  };
  observations?: Frame[];
  conditioned_inputs?: Frame[];
  comparison: Comparison | null;
};
export type Results = { prediction?: Future; reality?: Future; comparison?: Comparison | null };
