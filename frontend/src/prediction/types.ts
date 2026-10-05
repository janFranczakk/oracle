import type { Experiment, Frame, Vec2 } from '../types';

export type ModelDescription = {
  id: string;
  architecture: { family: 'mlp' | 'gru'; history: number; embedding: number; hidden: number };
  epoch: number;
  sha256: string;
  dataset_id: string;
  dataset_sha256: string;
  normalization_sha256: string;
  sample_stride: number;
  sample_dt: number;
  gravity: [number, number];
};
export type ModelCatalog = {
  models: ModelDescription[];
  unavailable: string[];
  torch_available: boolean;
};
export type ObjectError = {
  id: string;
  displacement_m: number;
  velocity_error_m_s: number;
  rotation_error_rad: number;
  predicted_contact: boolean;
  actual_contact: boolean;
};
export type HorizonError = {
  step: number;
  tick: number;
  seconds: number;
  displacement_m: number;
  position_mse: number;
  velocity_mse: number;
  rotation_mae_rad: number;
  objects: ObjectError[];
};
export type ObjectSummary = {
  id: string;
  ade_m: number;
  fde_m: number;
  position_mse: number;
  velocity_mse: number;
  rotation_mae_rad: number;
  contact_accuracy: number;
};
export type Prediction = {
  schema: 'oracle-prediction-v1';
  source: 'learned_model';
  created_at: string;
  anchor: { generation: string; tick: number; revision: number };
  anchor_frame: Frame;
  model: ModelDescription;
  model_version: string;
  horizon: number;
  frames: Frame[];
  reference: { source: 'pymunk-7.2.0'; conditions: 'held_at_anchor'; frames: Frame[] };
  metrics: {
    horizons: HorizonError[];
    objects: ObjectSummary[];
    summary: Omit<ObjectSummary, 'id' | 'contact_accuracy'> & {
      objects_scored: number;
      contact_accuracy: number;
      contact_balanced_accuracy: number | null;
      contact_counts: { tp: number; tn: number; fp: number; fn: number };
    };
  };
  uncertainty: null | { method: string; positionStd: Vec2[][] };
  elapsed_seconds: number;
  experiment: Experiment;
  observations: Frame[];
};
