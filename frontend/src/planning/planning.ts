import { create } from 'zustand';
import { request } from '../api/client';
import type { Frame, Vec2, WorldState } from '../types';
import type { Future, Plan } from '../counterfactual/types';
import type { ModelDescription, Prediction } from '../prediction/types';

export type Goal = Vec2 & { tolerance_m: number };
export type SearchRequest = {
  generation: string;
  anchor_tick: number;
  revision: number;
  model_id: string;
  object_id: string;
  goal: Goal;
  horizon: number;
  velocity_delta: number;
};
export type Candidate = {
  id: string;
  velocity: Vec2;
  delta: Vec2;
  velocity_change_m_s: number;
  input_order: number;
  goal_distance_m: number;
  predicted_within_goal: boolean;
  trajectory: { tick: number; position: Vec2 }[];
};
export type PlanningReport = {
  format: 'oracle-planning-report-v1';
  id: string;
  algorithm: 'velocity_grid_endpoint_v1';
  objective: 'terminal_position_distance_m';
  selection_source: 'learned_model_only';
  created_at: string;
  plan: Plan;
  request: SearchRequest;
  model: ModelDescription;
  search_sha256: string;
  runtime: { python: string; torch: string; device: string; threads: number };
  candidates: Candidate[];
  selected_id: string;
  prediction: Future;
  elapsed_seconds: number;
  verification: {
    reality: Future;
    actual_goal_distance_m: number;
    actual_within_goal: boolean;
    goal_distance_error_m: number;
    target_error: Prediction['metrics']['objects'][number];
    metrics: Prediction['metrics'];
    selection_updated: false;
  } | null;
};
export type Controls = {
  modelId: string;
  objectId: string;
  x: string;
  y: string;
  tolerance: string;
  delta: string;
  horizon: string;
};
type Store = Controls & {
  owner: string | null;
  report: PlanningReport | null;
  step: number;
  set: (patch: Partial<Omit<Store, 'set'>>) => void;
};
export const usePlanning = create<Store>((set) => ({
  modelId: '',
  objectId: 'orb-01',
  x: '12',
  y: '3',
  tolerance: '0.5',
  delta: '3',
  horizon: '50',
  owner: null,
  report: null,
  step: 0,
  set,
}));
function bounded(value: string, low: number, high: number, label: string) {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < low || number > high)
    throw new Error(`${label} must be between ${low} and ${high}.`);
  return number;
}
export function goalFromControls(c: Controls): Goal {
  return {
    x: bounded(c.x, 0, 24, 'Goal X'),
    y: bounded(c.y, 0, 14, 'Goal Y'),
    tolerance_m: bounded(c.tolerance, 0.05, 3, 'Goal tolerance'),
  };
}
export function searchRequest(world: WorldState, c: Controls): SearchRequest {
  if (world.playing) throw new Error('Pause the world before planning.');
  if (!world.objects.some((b) => b.id === c.objectId && !b.static))
    throw new Error('Choose a dynamic object in the current source.');
  const horizon = bounded(c.horizon, 1, 120, 'Horizon');
  if (!Number.isInteger(horizon)) throw new Error('Horizon must be a whole observed step.');
  return {
    generation: world.generation,
    anchor_tick: world.tick,
    revision: world.revision,
    model_id: c.modelId,
    object_id: c.objectId,
    goal: goalFromControls(c),
    horizon,
    velocity_delta: bounded(c.delta, 0.1, 15, 'Velocity grid step'),
  };
}
export function matchesControls(report: PlanningReport, c: Controls) {
  try {
    const goal = goalFromControls(c);
    const r = report.request;
    return (
      r.model_id === c.modelId &&
      r.object_id === c.objectId &&
      r.horizon === Number(c.horizon) &&
      r.velocity_delta === Number(c.delta) &&
      r.goal.x === goal.x &&
      r.goal.y === goal.y &&
      r.goal.tolerance_m === goal.tolerance_m
    );
  } catch {
    return false;
  }
}
export function atStep(
  future: Pick<Future, 'anchor_frame' | 'frames' | 'horizon'>,
  step: number,
): Frame {
  return step < 1 ? future.anchor_frame : future.frames[Math.min(step, future.horizon) - 1];
}
export const planningApi = {
  search: (sid: string, value: SearchRequest) =>
    request<PlanningReport>(`/sessions/${sid}/planning/search`, value),
  reality: (sid: string, identity: string) =>
    request<PlanningReport>(`/sessions/${sid}/planning/${identity}/reality`, {}),
};
