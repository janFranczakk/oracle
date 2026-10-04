import { beforeEach, describe, expect, it } from 'vitest';
import { mergeFrame, tickFromFraction, useLab } from './lab';
import type { Body, WorldState } from '../types';

const body: Body = {
  id: 'a',
  label: 'Sphere',
  shape: 'circle',
  static: false,
  position: { x: 2, y: 4 },
  velocity: { x: 1, y: 2 },
  rotation: 0,
  angular_velocity: 0,
  mass: 2,
  friction: 0.4,
  restitution: 0.8,
  width: 1,
  height: 1,
  radius: 0.5,
};
const world: WorldState = {
  type: 'full',
  tick: 0,
  duration: 0,
  playing: false,
  speed: 1,
  revision: 0,
  objects: [body],
  collisions: [],
  seed: 42,
  scene: 'incline',
  environment: { width: 24, height: 14, gravity: { x: 0, y: -9.81 }, dt: 1 / 120, iterations: 20 },
};
beforeEach(() =>
  useLab.setState({ world: null, history: [], selectedId: 'a', preview: null, follow: false }),
);
describe('Observation state', () => {
  it('a camera reset exits follow so the camera can return to the complete world', () => {
    useLab.setState({ follow: true, cameraAction: { kind: 'focus', seq: 2 } });
    useLab.getState().camera('reset');
    expect(useLab.getState().follow).toBe(false);
    expect(useLab.getState().cameraAction).toEqual({ kind: 'reset', seq: 3 });
  });
  it('merges transforms without losing object properties or changing prior frames', () => {
    const updated = mergeFrame(world, {
      type: 'frame',
      tick: 6,
      duration: 6,
      playing: true,
      speed: 1,
      revision: 0,
      collisions: ['a'],
      transforms: [
        {
          id: 'a',
          position: { x: 4, y: 7 },
          velocity: { x: 2, y: 3 },
          rotation: 0.3,
          angular_velocity: 1,
        },
      ],
    });
    expect(updated.objects[0].mass).toBe(2);
    expect(updated.objects[0].position.x).toBe(4);
    expect(world.objects[0].position.x).toBe(2);
  });
  it('clears stale selection when an object is removed', () => {
    useLab.getState().receive(world);
    useLab.getState().receive({ ...world, objects: [], revision: 1 });
    expect(useLab.getState().selectedId).toBeNull();
  });
  it('resets recorded trails on seek and edits', () => {
    useLab.getState().receive(world);
    useLab.getState().receive({ ...world, tick: 12, duration: 12 });
    useLab.getState().receive({ ...world, tick: 6, duration: 12, revision: 1 });
    expect(useLab.getState().history.map((f) => f.tick)).toEqual([6]);
  });
  it('selection discards an intervention preview and disables follow', () => {
    useLab.setState({ preview: { mass: 9 }, follow: true });
    useLab.getState().select('b');
    expect(useLab.getState().preview).toBeNull();
    expect(useLab.getState().follow).toBe(false);
  });
  it('keeps research separate from live physics', () => {
    useLab.getState().receive(world);
    useLab.getState().set({ page: 'research' });
    expect(useLab.getState().world).toEqual(world);
    expect('prediction' in useLab.getState()).toBe(false);
  });
});
describe('Timeline mapping', () => {
  it('maps fractions to discrete recorded ticks', () => {
    expect(tickFromFraction(0.42, 1000)).toBe(420);
    expect(tickFromFraction(0.333, 10)).toBe(3);
  });
  it('clamps to the recording and handles empty history', () => {
    expect(tickFromFraction(-2, 100)).toBe(0);
    expect(tickFromFraction(2, 100)).toBe(100);
    expect(tickFromFraction(0.5, 0)).toBe(0);
  });
});
