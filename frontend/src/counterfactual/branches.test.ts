import { beforeEach, describe, expect, it } from 'vitest';
import {
  aligned,
  applyChanges,
  changeSummary,
  differences,
  measured,
  sampledFrame,
  treeRows,
} from './branches';
import { useBranches } from './state';
import { useLab } from '../state/lab';
import type { Body, Frame } from '../types';
import type { Change, Description, Future, Plan } from './types';

const body: Body = {
  id: 'ball',
  label: 'Sphere',
  shape: 'circle',
  static: false,
  position: { x: 3, y: 4 },
  velocity: { x: 1, y: 0 },
  mass: 2,
  friction: 0.5,
  restitution: 0.6,
  rotation: 0,
  angular_velocity: 0,
  width: 1,
  height: 1,
  radius: 0.5,
};
const anchor: Frame = { tick: 12, objects: [body], collisions: [] };
it('omits absent properties serialized as null in portable intervention patches', () => {
  const change: Change = JSON.parse(
    '{"kind":"update","object_id":"ball","patch":{"mass":4,"position":null,"velocity":null,"rotation":null}}',
  );
  const preview = applyChanges(anchor, [change]);
  expect(preview.objects[0]).toEqual({ ...body, mass: 4 });
  expect(changeSummary(change)).toBe('ball · mass');
  expect(anchor.objects[0]).toEqual(body);
});
const plan: Plan = {
  format: 'oracle-counterfactual-plan-v1',
  id: 'a'.repeat(32),
  snapshot: {
    created_at: '',
    source: { generation: 'g', anchor_tick: 12, revision: 0 },
    frame: anchor,
    experiment: {
      schema_version: 1,
      engine: 'pymunk-7.2.0',
      model_version: null,
      created_at: '',
      origin: {
        seed: 42,
        scene: 'incline',
        objects: [body],
        environment: {
          width: 24,
          height: 14,
          gravity: { x: 0, y: -9.81 },
          dt: 1 / 120,
          iterations: 20,
        },
      },
      events: [],
      duration: 12,
      playhead: 12,
    },
  },
  branches: [
    { id: 'baseline', name: 'Baseline', parent_id: null, changes: [] },
    {
      id: 'a',
      name: 'A',
      parent_id: 'baseline',
      changes: [{ kind: 'update', object_id: 'ball', patch: { mass: 4 } }],
    },
    { id: 'b', name: 'B', parent_id: 'baseline', changes: [{ kind: 'remove', object_id: 'ball' }] },
    {
      id: 'c',
      name: 'C',
      parent_id: 'a',
      changes: [{ kind: 'update', object_id: 'ball', patch: { friction: 0.1 } }],
    },
  ],
};
const description: Description = {
  plan,
  previews: { baseline: anchor, a: anchor, b: anchor, c: anchor },
  fingerprints: { baseline: 'base-sha', a: 'a-sha', b: 'b-sha', c: 'c-sha' },
};
function future(source: Future['source'] = 'learned_model'): Future {
  return {
    format: 'oracle-counterfactual-future-v1',
    source,
    plan_id: plan.id,
    branch_id: 'a',
    branch_sha256: 'a-sha',
    created_at: '',
    anchor_frame: anchor,
    horizon: 2,
    sample_stride: 4,
    sample_dt: 1 / 30,
    frames: [
      { ...anchor, tick: 16 },
      { ...anchor, tick: 20 },
    ],
    uncertainty: null,
    elapsed_seconds: 0.1,
    ...(source === 'learned_model'
      ? {
          model: {
            id: 'gru',
            sha256: 'model-sha',
            epoch: 1,
            architecture: { family: 'gru' as const, history: 4, embedding: 64, hidden: 64 },
            dataset_id: 'data',
            dataset_sha256: 'd',
            normalization_sha256: 'n',
            sample_stride: 4,
            sample_dt: 1 / 30,
            gravity: [0, -9.81] as [number, number],
          },
        }
      : {}),
    comparison: null,
  };
}
const metrics = {
  horizons: [],
  objects: [],
  summary: {
    objects_scored: 2,
    ade_m: 1,
    fde_m: 2,
    position_mse: 1,
    velocity_mse: 1,
    rotation_mae_rad: 0,
    contact_accuracy: 1,
    contact_balanced_accuracy: null,
    contact_counts: { tp: 0, tn: 2, fp: 0, fn: 0 },
  },
};
beforeEach(() => {
  useBranches.setState({
    description: structuredClone(description),
    selected: 'a',
    compare: 'baseline',
    selectedObject: 'ball',
    results: {},
    draft: [],
    step: 0,
  });
});

describe('Immutable branch previews and tree', () => {
  it('changes transforms and parameters without modifying its parent', () => {
    const copy = structuredClone(anchor);
    const preview = applyChanges(anchor, [
      { kind: 'update', object_id: 'ball', patch: { mass: 4, position: { x: 8, y: 9 } } },
    ]);
    expect(preview.objects[0].mass).toBe(4);
    expect(anchor).toEqual(copy);
    preview.objects[0].velocity.x = 99;
    expect(anchor.objects[0].velocity.x).toBe(1);
  });
  it('inserts and removes stable identities without running dynamics', () => {
    const preview = applyChanges(anchor, [
      { kind: 'remove', object_id: 'ball' },
      { kind: 'add', object: { ...body, id: 'copy' } },
    ]);
    expect(preview.objects.map((b) => b.id)).toEqual(['copy']);
    expect(preview.tick).toBe(12);
    expect(anchor.objects[0].id).toBe('ball');
  });
  it('places children under their parent instead of creation order', () => {
    expect(treeRows(plan).map((r) => [r.branch.id, r.depth])).toEqual([
      ['baseline', 0],
      ['a', 1],
      ['c', 2],
      ['b', 1],
    ]);
  });
  it('clears only uncommitted drafts when switching alternatives', () => {
    useBranches.setState({
      draft: [{ kind: 'remove', object_id: 'ball' }],
      results: { a: { prediction: future() } },
      step: 2,
    });
    useBranches.getState().select('b');
    expect(useBranches.getState().draft).toEqual([]);
    expect(useBranches.getState().results.a.prediction).toBeDefined();
    expect(useBranches.getState().step).toBe(0);
  });
});
describe('Shared sampled cursor and comparisons', () => {
  it('keeps the anchor separate from future samples and clamps endpoints', () => {
    expect(sampledFrame(future(), anchor, 0)).toBe(anchor);
    expect(sampledFrame(future(), anchor, 1).tick).toBe(16);
    expect(sampledFrame(future(), anchor, 100).tick).toBe(20);
  });
  it('rejects mismatched clocks, horizons and tick arrays', () => {
    const a = future(),
      b = future('pymunk-7.2.0');
    expect(aligned(a, b)).toBe(true);
    expect(aligned(a, { ...b, sample_stride: 5 })).toBe(false);
    expect(aligned(a, { ...b, horizon: 1 })).toBe(false);
    expect(aligned(a, { ...b, frames: [{ ...anchor, tick: 17 }, b.frames[1]] })).toBe(false);
  });
  it('scores branch differences by common dynamic identities only', () => {
    const right = {
      ...anchor,
      objects: [
        { ...body, position: { x: 6, y: 8 } },
        { ...body, id: 'new' },
      ],
    };
    const result = differences(anchor, right);
    expect(result.mean).toBe(5);
    expect(result.onlyRight).toEqual(['new']);
    expect(differences({ ...anchor, objects: [] }, right).mean).toBeNull();
  });
  it('never exposes a metric before matching model, branch and reality exist', () => {
    const comparison = { model_sha256: 'model-sha', branch_sha256: 'a-sha', metrics };
    expect(measured({ prediction: future(), comparison })).toBeNull();
    expect(measured({ prediction: future(), reality: future('pymunk-7.2.0'), comparison })).toEqual(
      metrics,
    );
    expect(
      measured({
        prediction: future(),
        reality: future('pymunk-7.2.0'),
        comparison: { ...comparison, model_sha256: 'other' },
      }),
    ).toBeNull();
  });
});
describe('Source identity and report storage', () => {
  it('rejects results from another plan or changed branch fingerprint', () => {
    expect(useBranches.getState().accept({ ...future(), plan_id: 'other' })).toBe(false);
    expect(useBranches.getState().accept({ ...future(), branch_sha256: 'other' })).toBe(false);
    expect(useBranches.getState().results).toEqual({});
  });
  it('keeps independent branch futures and verifies the measured pair', () => {
    expect(useBranches.getState().accept(future())).toBe(true);
    expect(measured(useBranches.getState().results.a)).toBeNull();
    const reality = future('pymunk-7.2.0');
    reality.comparison = { model_sha256: 'model-sha', branch_sha256: 'a-sha', metrics };
    expect(useBranches.getState().accept(reality)).toBe(true);
    expect(measured(useBranches.getState().results.a)).toEqual(metrics);
    expect(useBranches.getState().results.baseline).toBeUndefined();
  });
  it('retains immutable results through live-world edits', () => {
    useBranches.getState().accept(future());
    useLab.setState({ prediction: null, preview: { mass: 9 } });
    expect(useBranches.getState().results.a.prediction?.branch_sha256).toBe('a-sha');
  });
  it('starts a restored plan without trusting old result metrics', () => {
    useBranches.getState().accept(future());
    useBranches
      .getState()
      .setDescription({ ...description, plan: { ...plan, id: 'b'.repeat(32) } });
    expect(useBranches.getState().results).toEqual({});
    expect(useBranches.getState().selected).toBe('baseline');
  });
});
