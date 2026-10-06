import { describe, expect, it } from 'vitest';
import { samplingOptions } from './diagnostics';

describe('sampling configuration', () => {
  it('keeps legacy models deterministic even when sampling is selected', () => {
    expect(samplingOptions(false, { samples: 16, seed: 'bad' })).toEqual({
      samples: 0,
      sampling_seed: 7,
    });
  });
  it('accepts zero and the full uint32 seed boundary', () => {
    expect(samplingOptions(true, { samples: 16, seed: '0' }).sampling_seed).toBe(0);
    expect(samplingOptions(true, { samples: 32, seed: '4294967295' }).sampling_seed).toBe(
      4294967295,
    );
  });
  it.each(['', '-1', '1.5', '4294967296', 'NaN'])('rejects an invalid seed %s', (seed) => {
    expect(() => samplingOptions(true, { samples: 16, seed })).toThrow();
  });
});
