import { describe, expect, it } from 'vitest';
import { frameFor } from '@/game/framing';
import { FRAME_DIST_MAX, FRAME_DIST_MIN, PLAY_AREA } from '@/game/shapes';

const box = (x: number, y: number, z: number, h = 1) => ({ x, y, z, hx: h, hy: h, hz: h });

describe('camera framing', () => {
  it('looks at the middle of the rug when there are no blocks', () => {
    const f = frameFor([], 0.5, 45);
    expect([f.cx, f.cz]).toEqual([0, 0]);
    expect(f.distance).toBeGreaterThanOrEqual(FRAME_DIST_MIN);
  });

  it('a portrait phone needs more distance than a landscape tablet (the narrow side decides)', () => {
    const blocks = [box(0, 1, 0)];
    expect(frameFor(blocks, 0.46, 45).distance).toBeGreaterThan(frameFor(blocks, 1.8, 45).distance);
  });

  it('zooms out as the blocks spread out, and for a really tall tower', () => {
    const small = frameFor([box(0, 1, 0)], 1, 45).distance;
    const tall = frameFor([box(0, 1, 0), box(0, 14, 0), box(0, 30, 0)], 1, 45).distance;
    const wide = frameFor([box(-8, 1, 0), box(8, 1, 0)], 1, 45).distance;
    expect(tall).toBeGreaterThan(small);
    expect(wide).toBeGreaterThan(small);
  });

  it('follows the blocks but keeps the look-at point inside the arena, and caps the distance', () => {
    const f = frameFor([box(40, 1, 0), box(60, 30, 0)], 0.5, 45);
    expect(Math.hypot(f.cx, f.cz)).toBeLessThanOrEqual(PLAY_AREA * 0.75 + 1e-9);
    expect(f.distance).toBeLessThanOrEqual(FRAME_DIST_MAX);
  });

  it('centres on the castle, not on the rug', () => {
    const f = frameFor([box(5, 1, -4), box(7, 1, -4)], 1, 45);
    expect(f.cx).toBeCloseTo(6, 6);
    expect(f.cz).toBeCloseTo(-4, 6);
  });
});
