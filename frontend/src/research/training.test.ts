import { describe, expect, it } from 'vitest';
import { groupName, measured, rolloutChart, trainingConfig } from './training';
import type { Group } from './training';

describe('training experiment configuration', () => {
  it('trains attention dropout rather than adding inference-only random noise', () => {
    expect(trainingConfig('transformer', '35', '7', '4').model).toEqual({
      family: 'transformer',
      history: 4,
      embedding: 64,
      hidden: 64,
      heads: 4,
      layers: 2,
      dropout: 0.1,
    });
  });
  it('uses a real CPU recipe with interchangeable temporal architecture', () => {
    const config = trainingConfig('gru', '35', '7', '4');
    expect(config.model.family).toBe('gru');
    expect(config.model.history).toBe(4);
    expect(config.horizons).toEqual([1, 5, 10, 20, 50]);
    expect(config.device).toBe('cpu');
  });
  it.each([
    ['0', '7', '4'],
    ['121', '7', '4'],
    ['1.5', '7', '4'],
    ['35', '-1', '4'],
    ['35', '4294967296', '4'],
    ['35', '7', '9'],
  ])('rejects invalid input %s %s %s', (epochs, seed, history) => {
    expect(() => trainingConfig('mlp', epochs, seed, history)).toThrow();
  });
});
it('distinguishes missing measurements, tiny error and exact zero', () => {
  expect(measured(null)).toBe('—');
  expect(measured(NaN)).toBe('—');
  expect(measured(0)).toBe('0.0000');
  expect(measured(0.000001)).toBe('1.00e-6');
});
it('labels the holdout distribution rather than hiding it under a combined score', () => {
  expect(groupName('ood/unseen_mass')).toBe('OOD · Unseen mass');
  expect(groupName('test')).toBe('Held-out test');
});
it('joins baseline values by horizon without inventing missing data', () => {
  const group = {
    rollout: {
      learned: [
        { horizon: 1, fde_m: 0.1 },
        { horizon: 10, fde_m: 1 },
      ],
      constant_velocity: [{ horizon: 10, fde_m: 2 }],
    },
  } as Group;
  expect(rolloutChart(group)).toEqual([
    { horizon: 1, learned: 0.1, baseline: null },
    { horizon: 10, learned: 1, baseline: 2 },
  ]);
});
