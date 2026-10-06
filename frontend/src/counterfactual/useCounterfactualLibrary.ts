import { useState } from 'react';
import { useLab } from '../state/lab';
import { useBranches } from './state';
import { branchApi, measured } from './branches';
import type { Plan, Results } from './types';

const LIBRARY_KEY = 'oracle.counterfactual-plans.v1';
type Saved = { name: string; plan: Plan };
function library(): Saved[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((v) => v?.plan?.format === 'oracle-counterfactual-plan-v1').slice(0, 2)
      : [];
  } catch {
    return [];
  }
}
export function useCounterfactualLibrary({
  plan,
  results,
  sid,
  perform,
  onRestored,
  notify,
}: {
  plan: Plan | undefined;
  results: Record<string, Results>;
  sid: string | null;
  perform: (label: string, action: () => Promise<void>) => Promise<void>;
  onRestored: () => void;
  notify: (message: string) => void;
}) {
  const [saved, setSaved] = useState(library);
  const [savedId, setSavedId] = useState('');
  const save = () => {
    if (!plan) return;
    try {
      const next = [
        {
          name: `${plan.snapshot.experiment.origin.scene} · t${plan.snapshot.frame.tick} · ${plan.branches.length} branches`,
          plan,
        },
        ...saved.filter((v) => v.plan.id !== plan.id),
      ].slice(0, 2);
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(next));
      setSaved(next);
      setSavedId(plan.id);
      notify(
        'Plan saved locally. Model weights and computed futures remain separate; export results to keep them.',
      );
    } catch {
      useLab
        .getState()
        .set({ error: 'Browser storage is full. Export this experiment to preserve it.' });
    }
  };
  const restore = (value: unknown) =>
    perform('Validating saved source replay', async () => {
      if (!sid) return;
      const data = await branchApi.restore(sid, value);
      useBranches.getState().setDescription(data);
      onRestored();
      notify(
        'Source and branches restored after replay validation. Imported results are not trusted; run new futures.',
      );
    });
  const download = () => {
    if (!plan) return;
    const report = {
      format: 'oracle-counterfactual-report-v1',
      created_at: new Date().toISOString(),
      plan,
      results: Object.fromEntries(
        Object.entries(results).map(([id, result]) => [
          id,
          { ...result, metrics: measured(result) },
        ]),
      ),
      uncertainty: Object.values(results).some((result) => result.prediction?.uncertainty)
        ? {
            method: 'mc_dropout_autoregressive_v1',
            calibrated: false,
            location: 'results[branch].prediction.uncertainty',
          }
        : null,
    };
    const raw = JSON.stringify(report, null, 2);
    if (new Blob([raw]).size > 16 * 1024 * 1024) {
      useLab.getState().set({
        error: 'This report exceeds the 16 MiB export limit. Export a smaller experiment.',
      });
      return;
    }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const element = document.createElement('a');
    element.href = url;
    element.download = `oracle-counterfactual-t${plan.snapshot.frame.tick}.json`;
    element.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return { saved, savedId, setSavedId, save, restore, download };
}
