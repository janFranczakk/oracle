import { describe, expect, it } from 'vitest';
import { familyMetric, meanSpread } from './families';
import type { SeedStudy, SampleStatistics } from './families';

const stats: SampleStatistics = {
  n: 2,
  missing: 0,
  mean: 2,
  std: 1,
  median: 2,
  min: 1,
  max: 3,
  mean_ci95: [-6.985, 10.985],
};
describe('family comparison preserves measured repeats', () => {
  it('displays the measured sample spread, not a trajectory confidence interval', () => {
    expect(meanSpread(stats)).toBe('2.000 ± 1.000');
    expect(stats.mean_ci95).toEqual([-6.985, 10.985]);
  });
  it('does not invent absent metrics or a single-run sample standard deviation', () => {
    expect(meanSpread(undefined)).toBe('—');
    expect(meanSpread({ ...stats, n: 1, std: null, mean_ci95: null })).toBe('2.000 ± —');
    expect(meanSpread({ ...stats, n: 0, mean: null })).toBe('—');
  });
  it('pairs exact group, scope, horizon and metric without nearest-horizon substitution', () => {
    const family: SeedStudy['families'][number] = {
      family: 'gru',
      seeds: [1, 2],
      runs: [],
      metrics: [
        { group: 'test', scope: 'rollout', horizon: 50, metric: 'fde_m', statistics: stats },
      ],
    };
    expect(familyMetric(family, 'test', 'rollout', 50, 'fde_m')).toBe(stats);
    expect(familyMetric(family, 'test', 'rollout', 10, 'fde_m')).toBeUndefined();
    expect(familyMetric(family, 'ood/macro', 'rollout', 50, 'fde_m')).toBeUndefined();
  });
});
