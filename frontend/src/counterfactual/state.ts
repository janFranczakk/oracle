import { create } from 'zustand';
import { measured } from './branches';
import type { Change, Description, Future, Results } from './types';

type State = {
  description: Description | null;
  selected: string;
  compare: string;
  selectedObject: string | null;
  draft: Change[];
  results: Record<string, Results>;
  step: number;
  source: 'prediction' | 'reality';
  view: 'overlay' | 'split';
  modelId: string;
  horizon: number;
  set: (patch: Partial<State>) => void;
  setDescription: (value: Description) => void;
  select: (id: string) => void;
  accept: (future: Future) => boolean;
};
export const useBranches = create<State>((set, get) => ({
  description: null,
  selected: 'baseline',
  compare: 'baseline',
  selectedObject: 'orb-01',
  draft: [],
  results: {},
  step: 0,
  source: 'prediction',
  view: 'overlay',
  modelId: '',
  horizon: 50,
  set: (patch) => set(patch),
  setDescription: (description) =>
    set((state) => ({
      description,
      ...(state.description?.plan.id !== description.plan.id
        ? {
            selected: description.plan.branches[0].id,
            compare: description.plan.branches[0].id,
            results: {},
            draft: [],
            step: 0,
            selectedObject:
              description.plan.snapshot.frame.objects.find((b) => !b.static)?.id || null,
          }
        : {}),
    })),
  select: (selected) => {
    if (!get().description?.previews[selected]) return;
    set({ selected, draft: [], step: 0 });
  },
  accept: (future) => {
    const state = get();
    if (
      future.plan_id !== state.description?.plan.id ||
      future.branch_sha256 !== state.description?.fingerprints[future.branch_id]
    )
      return false;
    const key = future.source === 'learned_model' ? 'prediction' : 'reality';
    const results = {
      ...state.results[future.branch_id],
      [key]: future,
      comparison: future.comparison,
    };
    if (!measured(results)) results.comparison = null;
    set({
      results: { ...state.results, [future.branch_id]: results },
      ...(state.selected === future.branch_id ? { step: future.horizon, source: key } : {}),
    });
    return true;
  },
}));
