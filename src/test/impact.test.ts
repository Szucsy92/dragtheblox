import { describe, expect, it } from 'vitest';
import { impactStrength } from '@/game/impact';
import { GRAVITY } from '@/game/shapes';

describe('knock sound', () => {
  it('stays silent for a tall stack pressing steadily on its bottom block', () => {
    const steady = 9 * GRAVITY; // nine blocks' weight per unit mass, constant from step to step
    expect(impactStrength(steady, steady)).toBe(0);
    expect(impactStrength(steady * 1.4, steady)).toBe(0);
  });

  it('knocks on a sudden jump in force, louder for a harder hit', () => {
    const soft = impactStrength(20 * GRAVITY, 0);
    const hard = impactStrength(400 * GRAVITY, 0);
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeLessThanOrEqual(1);
  });

  it('ignores gentle contact below the threshold', () => {
    expect(impactStrength(3 * GRAVITY, 0)).toBe(0);
  });
});
