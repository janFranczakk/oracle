import { useLab } from '../state/lab';

export function useCounterfactualTask(pausePlayback: () => void) {
  return async (label: string, action: () => Promise<void>) => {
    if (useLab.getState().busy) return;
    useLab.getState().set({ busy: label, error: null });
    pausePlayback();
    try {
      await action();
    } catch (error) {
      useLab.getState().set({
        error:
          error instanceof Error ? error.message : 'Counterfactual operation failed. Try again.',
      });
    } finally {
      useLab.getState().set({ busy: null });
    }
  };
}
