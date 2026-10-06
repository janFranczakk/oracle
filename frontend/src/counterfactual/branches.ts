import { request } from '../api/client';
import type { Body, Frame } from '../types';
import type { Branch, Change, Description, Future, Plan, Results } from './types';

const root = (sid: string) => `/sessions/${sid}/counterfactual`;
export const branchApi = {
  capture: (sid: string, source: Plan['snapshot']['source']) =>
    request<Description>(`${root(sid)}/capture`, source),
  restore: (sid: string, plan: unknown) => request<Description>(`${root(sid)}/import`, plan),
  create: (sid: string, plan: string, parent_id: string, name: string, changes: Change[]) =>
    request<Description>(`${root(sid)}/${plan}/branches`, { parent_id, name, changes }),
  predict: (
    sid: string,
    plan: string,
    branch: string,
    model_id: string,
    horizon: number,
    sample_stride: number,
  ) =>
    request<Future>(`${root(sid)}/${plan}/${branch}/predict`, { model_id, horizon, sample_stride }),
  reality: (sid: string, plan: string, branch: string, horizon: number, sample_stride: number) =>
    request<Future>(`${root(sid)}/${plan}/${branch}/reality`, { horizon, sample_stride }),
};

export function treeRows(plan: Plan): { branch: Branch; depth: number }[] {
  const rows: { branch: Branch; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const branch of plan.branches.filter((b) => b.parent_id === parent)) {
      rows.push({ branch, depth });
      visit(branch.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

// This is a transform / material preview, never dynamics integration.
export function applyChanges(frame: Frame, changes: Change[]): Frame {
  const objects = new Map(structuredClone(frame.objects).map((b) => [b.id, b]));
  for (const change of changes) {
    if (change.kind === 'remove') objects.delete(change.object_id);
    else if (change.kind === 'add') objects.set(change.object.id, structuredClone(change.object));
    else {
      const current = objects.get(change.object_id);
      if (!current) continue;
      objects.delete(current.id);
      const patch = Object.fromEntries(
        Object.entries(structuredClone(change.patch)).filter(([, value]) => value != null),
      );
      objects.set(current.id, { ...current, ...patch });
    }
  }
  return {
    tick: frame.tick,
    objects: [...objects.values()],
    collisions: changes.length ? [] : frame.collisions,
  };
}

export function sampledFrame(future: Future | undefined, anchor: Frame, step: number): Frame {
  if (!future || step === 0) return anchor;
  return future.frames[Math.max(0, Math.min(future.horizon - 1, Math.round(step) - 1))];
}

export function aligned(a: Future | undefined, b: Future | undefined) {
  return (
    !!a &&
    !!b &&
    a.sample_stride === b.sample_stride &&
    a.horizon === b.horizon &&
    a.anchor_frame.tick === b.anchor_frame.tick &&
    a.frames.every((frame, i) => frame.tick === b.frames[i]?.tick)
  );
}

export function measured(results: Results | undefined) {
  if (!results?.comparison || !aligned(results.prediction, results.reality)) return null;
  const { prediction, reality, comparison } = results;
  return prediction!.branch_sha256 === reality!.branch_sha256 &&
    comparison.branch_sha256 === prediction!.branch_sha256 &&
    comparison.model_sha256 === prediction!.model?.sha256
    ? comparison.metrics
    : null;
}

export function differences(left: Frame, right: Frame) {
  const common = left.objects.filter(
    (a) => !a.static && right.objects.some((b) => b.id === a.id && !b.static),
  );
  const objects = common.map((a) => {
    const b = right.objects.find((b) => b.id === a.id)!;
    return {
      id: a.id,
      distance: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y),
      left: a,
      right: b,
    };
  });
  const leftIds = new Set(left.objects.map((b) => b.id)),
    rightIds = new Set(right.objects.map((b) => b.id));
  return {
    objects,
    mean: objects.length ? objects.reduce((sum, o) => sum + o.distance, 0) / objects.length : null,
    onlyLeft: [...leftIds].filter((id) => !rightIds.has(id)),
    onlyRight: [...rightIds].filter((id) => !leftIds.has(id)),
  };
}

export function newObstacle(shape: 'wall' | 'box'): Body {
  return {
    id: `${shape}-${crypto.randomUUID().slice(0, 8)}`,
    label: shape === 'wall' ? 'Counterfactual wall' : 'Counterfactual block',
    shape,
    static: shape === 'wall',
    position: { x: 12, y: 6 },
    velocity: { x: 0, y: 0 },
    rotation: 0,
    angular_velocity: 0,
    mass: 2,
    friction: 0.5,
    restitution: 0.65,
    width: shape === 'wall' ? 0.3 : 1.2,
    height: shape === 'wall' ? 5 : 1.2,
    radius: 0.5,
  };
}

export function changeSummary(change: Change) {
  if (change.kind === 'add') return `Add ${change.object.label}`;
  if (change.kind === 'remove') return `Remove ${change.object_id}`;
  return `${change.object_id} · ${Object.entries(change.patch || {})
    .filter(([, value]) => value != null)
    .map(([key]) => key)
    .join(', ')}`;
}
