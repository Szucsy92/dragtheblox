import { describe, it, expect } from 'vitest';
import { supportedAbove, gestureVelocity, throwVelocity, carryImpulse } from '@/game/manipulation';
import { PLAY_AREA, GROUP_BLOCK, GROUP_HELD } from '@/game/shapes';
import type { Other } from '@/game/placement';

const cube = (id: number, y: number, x = 0): Other => ({ id, kind: 'cube', x, y, z: 0, q: { x: 0, y: 0, z: 0, w: 1 } });
describe('physical manipulation', () => {
  it('doubles the original 6.2 radius', () => expect(PLAY_AREA).toBe(6.2 * 2));
  it('keeps held blocks colliding with the tower', () => expect(GROUP_HELD).toBe(GROUP_BLOCK));
  it('finds the whole contact-connected tower above its base, excluding neighbours', () => {
    expect(supportedAbove(cube(1, 0.9), [cube(2, 2.6), cube(3, 4.3), cube(4, 0.9, 4)])).toEqual([2, 3]);
  });
  it('preserves slow-stack friction but allows a jerk to overcome it', () => {
    const slow = carryImpulse({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.02, false, 1);
    const jerk = carryImpulse({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0.02, true, 1);
    expect(slow.x).toBeCloseTo(0.05);
    expect(jerk.x).toBeCloseTo(1.8);
  });
  it('launches toward the target from a recent flick even if the body stalled', () => {
    const v = gestureVelocity([{ time: 0, x: 0, z: 0 }, { time: 100, x: 1.5, z: 0 }], 100);
    const launch = throwVelocity(v);
    expect(launch?.x).toBe(15);
    expect(launch?.y).toBe(1.5);
  });
  it('does not throw after a paused gesture or a gentle placement', () => {
    expect(throwVelocity(gestureVelocity([{ time: 0, x: 0, z: 0 }, { time: 100, x: 1.5, z: 0 }], 250))).toBeNull();
    expect(throwVelocity({ x: 0.5, y: 0, z: 0 })).toBeNull();
  });
});