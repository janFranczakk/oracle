import type { Body, WorldState } from '../types';
import type { ModelDescription, Prediction } from './types';

export function validAnchor(prediction: Prediction, world: WorldState | null) {
  return (
    !!world &&
    !world.playing &&
    world.generation === prediction.anchor.generation &&
    world.revision === prediction.anchor.revision &&
    world.tick === prediction.anchor.tick
  );
}

export function requiredTicks(world: WorldState, model: ModelDescription) {
  return Math.max(
    0,
    (model.architecture.history - 1) * model.sample_stride - (world.tick - world.last_edit_tick),
  );
}

export function compatibleEnvironment(world: WorldState, model: ModelDescription) {
  return (
    Math.abs(world.environment.gravity.x - model.gravity[0]) < 1e-12 &&
    Math.abs(world.environment.gravity.y - model.gravity[1]) < 1e-12 &&
    Math.abs(world.environment.dt * model.sample_stride - model.sample_dt) < 1e-12
  );
}

// Both series use exact sampled frames, never interpolation or a second physics implementation.
export function frameAt(prediction: Prediction, step: number, reference = false) {
  const index = Math.max(0, Math.min(prediction.horizon, Math.round(step)));
  return index === 0
    ? prediction.anchor_frame
    : (reference ? prediction.reference.frames : prediction.frames)[index - 1];
}

export function ghostSteps(horizon: number) {
  const stride = Math.max(1, Math.ceil(horizon / 8));
  const steps = Array.from(
    { length: Math.floor((horizon - 1) / stride) + 1 },
    (_, i) => 1 + i * stride,
  );
  if (steps.at(-1) !== horizon) steps.push(horizon);
  return steps;
}

export function ghostAlpha(step: number, horizon: number) {
  return 0.38 - 0.25 * Math.max(0, Math.min(1, step / horizon));
}

export function trajectory(prediction: Prediction, id: string, reference = false) {
  return [
    prediction.anchor_frame,
    ...(reference ? prediction.reference.frames : prediction.frames),
  ].flatMap((frame) => {
    const body = frame.objects.find((b) => b.id === id);
    return body ? [body.position] : [];
  });
}

export function pairedBodies(
  prediction: Prediction,
  step: number,
): { predicted: Body; actual: Body }[] {
  const actual = new Map(frameAt(prediction, step, true).objects.map((body) => [body.id, body]));
  return frameAt(prediction, step).objects.flatMap((body) => {
    const match = actual.get(body.id);
    return !body.static && match ? [{ predicted: body, actual: match }] : [];
  });
}
