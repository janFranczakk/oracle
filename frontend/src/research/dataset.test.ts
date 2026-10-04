import { describe, expect, it } from 'vitest';
import { collectionConfig, filterEpisodes, histogram } from './dataset';
import type { EpisodeEntry } from './dataset';

describe('dataset inspection', () => {
  it('keeps OOD suites and held-out episodes out of train selection', () => {
    const entries = [
      { id: 'a', split: 'train', suite: 'in_distribution' },
      { id: 'b', split: 'test', suite: 'in_distribution' },
      { id: 'c', split: 'ood', suite: 'unseen_mass' },
      { id: 'd', split: 'ood', suite: 'unseen_velocity' },
    ] as EpisodeEntry[];
    expect(filterEpisodes(entries, 'train', 'all').map((e) => e.id)).toEqual(['a']);
    expect(filterEpisodes(entries, 'ood', 'unseen_mass').map((e) => e.id)).toEqual(['c']);
    expect(filterEpisodes(entries, 'ood', 'all').map((e) => e.id)).toEqual(['c', 'd']);
  });
  it('counts histogram edge values without inventing or clipping out-of-range data', () => {
    expect(histogram([0, 0.5, 1, 2, -1, 3, NaN, Infinity], 2, 0, 2)).toEqual([2, 2]);
    expect(() => histogram([], 0, 0, 2)).toThrow();
    expect(() => histogram([], 2, 2, 2)).toThrow();
  });
  it('maps collection controls to an explicit independent-split configuration', () => {
    const config = collectionConfig('42', 'standard', '4');
    expect(config.train + config.validation + config.test + 6 * config.ood_per_suite).toBe(64);
    expect(config.steps / config.sample_stride).toBe(120);
    expect(collectionConfig('0', 'extended', '8').steps).toBe(960);
    expect(collectionConfig('4294967295', 'compact', '2').seed).toBe(4294967295);
  });
  it.each(['-1', '2.5', 'NaN', '', '4294967296'])('rejects invalid dataset seed %s', (seed) => {
    expect(() => collectionConfig(seed, 'standard', '4')).toThrow();
  });
});
