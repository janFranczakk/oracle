import { create } from 'zustand';
import type { Body, Frame, FrameMessage, WorldState } from '../types';
import type { Prediction } from '../prediction/types';
import { validAnchor } from '../prediction/forecast';

export function mergeFrame(state: WorldState, message: FrameMessage): WorldState {
  const updates = new Map(message.transforms.map((t) => [t.id, t]));
  return {
    ...state,
    ...message,
    type: 'full',
    objects: state.objects.map((o) => (updates.has(o.id) ? { ...o, ...updates.get(o.id) } : o)),
  };
}
export function tickFromFraction(fraction: number, duration: number) {
  return Math.round(Math.max(0, Math.min(1, fraction)) * duration);
}
type LabStore = {
  sessionId: string | null;
  world: WorldState | null;
  selectedId: string | null;
  connection: 'connecting' | 'online' | 'offline';
  busy: string | null;
  error: string | null;
  page: 'lab' | 'research';
  grid: boolean;
  vectors: boolean;
  trails: boolean;
  history: Frame[];
  preview: Partial<Body> | null;
  cameraAction: { kind: 'reset' | 'focus'; seq: number };
  follow: boolean;
  sidePanel: 'prediction' | 'object';
  prediction: Prediction | null;
  forecastStep: number;
  predictionModelId: string;
  predictionHorizon: number;
  ghosts: boolean;
  reference: boolean;
  errorVectors: boolean;
  acceptPrediction: (prediction: Prediction) => boolean;
  set: (patch: Partial<LabStore>) => void;
  receive: (message: WorldState | FrameMessage) => void;
  select: (id: string | null) => void;
  camera: (kind: 'reset' | 'focus') => void;
};
export const useLab = create<LabStore>((set, get) => ({
  sessionId: null,
  world: null,
  selectedId: 'orb-01',
  connection: 'connecting',
  busy: null,
  error: null,
  page: 'lab',
  grid: true,
  vectors: true,
  trails: false,
  history: [],
  preview: null,
  cameraAction: { kind: 'reset', seq: 0 },
  follow: false,
  sidePanel: 'prediction',
  prediction: null,
  forecastStep: 0,
  predictionModelId: '',
  predictionHorizon: 50,
  ghosts: true,
  reference: true,
  errorVectors: true,
  acceptPrediction: (prediction) => {
    if (!validAnchor(prediction, get().world)) return false;
    set({ prediction, forecastStep: prediction.horizon });
    return true;
  },
  set: (patch) => set(patch),
  select: (id) => set({ selectedId: id, preview: null, follow: false }),
  camera: (kind) =>
    set((state) => ({ follow: false, cameraAction: { kind, seq: state.cameraAction.seq + 1 } })),
  receive: (message) =>
    set((state) => {
      const world =
        message.type === 'full' ? message : state.world ? mergeFrame(state.world, message) : null;
      if (!world) return {};
      const discontinuity =
        !!state.world &&
        (world.generation !== state.world.generation ||
          world.revision !== state.world.revision ||
          world.tick < state.world.tick);
      const history = discontinuity ? [] : state.history;
      const frame = { tick: world.tick, objects: world.objects, collisions: world.collisions };
      return {
        world,
        prediction:
          state.prediction && validAnchor(state.prediction, world) ? state.prediction : null,
        history: [
          ...(history.at(-1)?.tick === world.tick ? history.slice(0, -1) : history).slice(-239),
          frame,
        ],
        selectedId:
          state.selectedId && world.objects.some((o) => o.id === state.selectedId)
            ? state.selectedId
            : null,
      };
    }),
}));
