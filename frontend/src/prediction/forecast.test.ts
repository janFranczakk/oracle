import { beforeEach, describe, expect, it } from 'vitest';
import type { Body, WorldState } from '../types';
import { useLab } from '../state/lab';
import {
  compatibleEnvironment,
  frameAt,
  ghostAlpha,
  ghostSteps,
  pairedBodies,
  requiredTicks,
  trajectory,
} from './forecast';
import type { ModelDescription, Prediction } from './types';

const body: Body = {
  id: 'sphere',
  label: 'Sphere',
  shape: 'circle',
  static: false,
  position: { x: 1, y: 2 },
  velocity: { x: 0, y: 0 },
  rotation: 0,
  angular_velocity: 0,
  mass: 2,
  friction: 0.5,
  restitution: 0.6,
  radius: 0.5,
  width: 1,
  height: 1,
};
const world: WorldState = {
  type: 'full',
  generation: 'a'.repeat(32),
  last_edit_tick: 0,
  tick: 12,
  duration: 12,
  revision: 0,
  playing: false,
  speed: 1,
  seed: 42,
  scene: 'incline',
  objects: [body],
  collisions: [],
  environment: { width: 24, height: 14, dt: 1 / 120, gravity: { x: 0, y: -9.81 }, iterations: 20 },
};
const model: ModelDescription = {
  id: 'gru',
  architecture: { family: 'gru', history: 4, embedding: 64, hidden: 64 },
  epoch: 28,
  sha256: 'b'.repeat(64),
  dataset_id: 'data',
  dataset_sha256: 'c'.repeat(64),
  normalization_sha256: 'd'.repeat(64),
  sample_stride: 4,
  sample_dt: 1 / 30,
  gravity: [0, -9.81],
};
const prediction: Prediction = {
  schema: 'oracle-prediction-v1',
  source: 'learned_model',
  created_at: '2026-10-05',
  anchor: { generation: world.generation, tick: 12, revision: 0 },
  anchor_frame: { tick: 12, objects: [body], collisions: [] },
  model,
  model_version: 'gru/epoch-28',
  horizon: 2,
  frames: [16, 20].map((tick, i) => ({
    tick,
    objects: [{ ...body, position: { x: 2 + i, y: 2 } }],
    collisions: [],
  })),
  reference: {
    source: 'pymunk-7.2.0',
    conditions: 'held_at_anchor',
    frames: [16, 20].map((tick) => ({ tick, objects: [body], collisions: [] })),
  },
  metrics: {
    horizons: [],
    objects: [],
    summary: {
      objects_scored: 2,
      ade_m: 1.5,
      fde_m: 2,
      position_mse: 1.25,
      velocity_mse: 0,
      rotation_mae_rad: 0,
      contact_accuracy: 1,
      contact_balanced_accuracy: null,
      contact_counts: { tp: 0, tn: 2, fp: 0, fn: 0 },
    },
  },
  uncertainty: null,
  elapsed_seconds: 0.1,
  experiment: {
    schema_version: 1,
    engine: 'pymunk-7.2.0',
    model_version: null,
    created_at: '',
    origin: { seed: 42, scene: 'incline', objects: [body], environment: world.environment },
    events: [],
    playhead: 12,
    duration: 12,
  },
  observations: [{ tick: 12, objects: [body], collisions: [] }],
};

beforeEach(() => useLab.setState({ world, prediction: null, history: [], forecastStep: 0 }));

describe('Real history and observation clock', () => {
  it('requires all real observations since the last edit', () => {
    expect(requiredTicks({ ...world, tick: 0 }, model)).toBe(12);
    expect(requiredTicks(world, model)).toBe(0);
    expect(requiredTicks({ ...world, last_edit_tick: 9 }, model)).toBe(9);
    expect(requiredTicks({ ...world, tick: 600 }, model)).toBe(0);
  });
  it('rejects models trained with a different environment or sampling clock', () => {
    expect(compatibleEnvironment(world, model)).toBe(true);
    expect(compatibleEnvironment(world, { ...model, gravity: [0, -5] })).toBe(false);
    expect(compatibleEnvironment(world, { ...model, sample_dt: 0.1 })).toBe(false);
  });
});

describe('Forecast geometry', () => {
  it('previews exact model / reference frames and clamps independently of live time', () => {
    expect(frameAt(prediction, 0)).toBe(prediction.anchor_frame);
    expect(frameAt(prediction, -99)).toBe(prediction.anchor_frame);
    expect(frameAt(prediction, 99).tick).toBe(20);
    expect(frameAt(prediction, 1).objects[0].position.x).toBe(2);
    expect(frameAt(prediction, 1, true).objects[0].position.x).toBe(1);
    expect(useLab.getState().world?.tick).toBe(12);
  });
  it('keeps each trajectory attributed to its actual source', () => {
    expect(trajectory(prediction, 'sphere').map((p) => p.x)).toEqual([1, 2, 3]);
    expect(trajectory(prediction, 'sphere', true).map((p) => p.x)).toEqual([1, 1, 1]);
    expect(pairedBodies(prediction, 2)[0]).toEqual({
      predicted: prediction.frames[1].objects[0],
      actual: body,
    });
    expect(trajectory(prediction, 'absent')).toEqual([]);
  });
  it('includes the last future with at most nine ghost samples and decreasing opacity', () => {
    for (const horizon of [1, 5, 10, 50, 120]) {
      const steps = ghostSteps(horizon);
      expect(steps[0]).toBe(1);
      expect(steps.at(-1)).toBe(horizon);
      expect(steps.length).toBeLessThanOrEqual(9);
      expect(new Set(steps).size).toBe(steps.length);
      expect(ghostAlpha(1, horizon)).toBeGreaterThanOrEqual(ghostAlpha(horizon, horizon));
    }
  });
});

describe('Prediction validity', () => {
  it('accepts a current anchored forecast without changing observations', () => {
    expect(useLab.getState().acceptPrediction(prediction)).toBe(true);
    useLab.getState().set({ forecastStep: 1 });
    expect(useLab.getState().world).toBe(world);
    expect(useLab.getState().forecastStep).toBe(1);
    useLab.getState().receive({ ...world, speed: 2 });
    expect(useLab.getState().prediction).toBe(prediction);
  });
  it.each([{ tick: 13 }, { playing: true }, { revision: 1 }, { generation: 'f'.repeat(32) }])(
    'clears a forecast when its anchor changes: %o',
    (patch) => {
      useLab.getState().acceptPrediction(prediction);
      useLab.getState().receive({ ...world, ...patch });
      expect(useLab.getState().prediction).toBeNull();
      expect(useLab.getState().acceptPrediction(prediction)).toBe(false);
    },
  );
  it('rejects delayed predictions after replacing a session at the same tick and revision', () => {
    useLab.getState().receive({ ...world, generation: 'e'.repeat(32) });
    expect(useLab.getState().acceptPrediction(prediction)).toBe(false);
  });
});
