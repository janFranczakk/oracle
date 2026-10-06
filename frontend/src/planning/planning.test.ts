import { describe, expect, it } from 'vitest';
import { atStep, goalFromControls, matchesControls, searchRequest } from './planning';
import type { Controls, PlanningReport } from './planning';
import type { Future } from '../counterfactual/types';
import type { Body, WorldState } from '../types';

const controls: Controls = {
  modelId: 'gru',
  objectId: 'ball',
  x: '12',
  y: '3',
  tolerance: '0.5',
  delta: '3',
  horizon: '50',
};
const body: Body = {
  id: 'ball',
  label: 'Ball',
  shape: 'circle',
  static: false,
  position: { x: 2, y: 5 },
  velocity: { x: 1, y: 0 },
  rotation: 0,
  angular_velocity: 0,
  mass: 2,
  friction: 0.5,
  restitution: 0.5,
  width: 1,
  height: 1,
  radius: 0.5,
};
const world: WorldState = {
  type: 'full',
  tick: 12,
  duration: 12,
  playing: false,
  speed: 1,
  revision: 2,
  generation: 'a'.repeat(32),
  last_edit_tick: 0,
  seed: 42,
  scene: 'incline',
  environment: { width: 24, height: 14, gravity: { x: 0, y: -9.81 }, dt: 1 / 120, iterations: 20 },
  objects: [body],
  collisions: [],
};
describe('planning source, goal and draft boundaries', () => {
  it('binds the exact observed anchor and physical-unit goal', () => {
    expect(searchRequest(world, controls)).toEqual({
      generation: world.generation,
      anchor_tick: 12,
      revision: 2,
      model_id: 'gru',
      object_id: 'ball',
      goal: { x: 12, y: 3, tolerance_m: 0.5 },
      horizon: 50,
      velocity_delta: 3,
    });
  });
  it.each([
    { x: '' },
    { x: '25' },
    { y: 'NaN' },
    { tolerance: '0' },
    { delta: '16' },
    { horizon: '1.5' },
    { horizon: '121' },
  ])('rejects invalid goal/search controls %j', (patch) => {
    expect(() => searchRequest(world, { ...controls, ...patch })).toThrow();
  });
  it('rejects a running source and static or missing controlled identities', () => {
    expect(() => searchRequest({ ...world, playing: true }, controls)).toThrow('Pause');
    expect(() =>
      searchRequest({ ...world, objects: [{ ...body, static: true }] }, controls),
    ).toThrow('dynamic');
    expect(() => searchRequest(world, { ...controls, objectId: 'missing' })).toThrow('dynamic');
  });
  it('keeps measured reports tied to their goal and settings when drafts change', () => {
    const report = { request: searchRequest(world, controls) } as PlanningReport;
    expect(matchesControls(report, controls)).toBe(true);
    for (const patch of [
      { x: '13' },
      { horizon: '20' },
      { modelId: 'mlp' },
      { objectId: 'other' },
      { delta: '2' },
      { tolerance: '1' },
      { x: '' },
    ])
      expect(matchesControls(report, { ...controls, ...patch })).toBe(false);
    expect(goalFromControls({ ...controls, x: '0', y: '14' })).toEqual({
      x: 0,
      y: 14,
      tolerance_m: 0.5,
    });
  });
  it('scrubs exact returned observations and clamps at the forecast endpoint', () => {
    const anchor = { tick: 12, objects: [body], collisions: [] };
    const first = { ...anchor, tick: 16 };
    const last = { ...anchor, tick: 20 };
    const future: Pick<Future, 'anchor_frame' | 'frames' | 'horizon'> = {
      anchor_frame: anchor,
      frames: [first, last],
      horizon: 2,
    };
    expect(atStep(future, 0)).toBe(anchor);
    expect(atStep(future, 1)).toBe(first);
    expect(atStep(future, 100)).toBe(last);
  });
});
