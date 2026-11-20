import { describe, it, expect } from 'vitest';
import { supportedAbove, gestureVelocity, throwVelocity, carryVelocity } from '@/game/manipulation';
import { PLAY_AREA, GROUP_BLOCK, GROUP_HELD, GROUP_PASSENGER, GROUP_GROUND, CARRY_MAX, FLICK_SPEED, THROW_MIN } from '@/game/shapes';
import type { Other } from '@/game/placement';

// Rapier's rule: two colliders touch when each one's membership meets the other's filter.
const touches = (a: number, b: number) => ((a >>> 16) & (b & 0xffff)) !== 0 && ((b >>> 16) & (a & 0xffff)) !== 0;
const cube = (id: number, y: number, x = 0): Other => ({ id, kind: 'cube', x, y, z: 0, q: { x: 0, y: 0, z: 0, w: 1 } });
describe('physical manipulation', () => {
  it('doubles the original 6.2 radius', () => expect(PLAY_AREA).toBe(6.2 * 2));
  it('the held block touches only the ground, the walls and its passengers: it can never shove the castle', () => {
    expect(touches(GROUP_HELD, GROUP_BLOCK)).toBe(false);
    expect(touches(GROUP_HELD, GROUP_PASSENGER)).toBe(true);
    expect(touches(GROUP_HELD, GROUP_GROUND)).toBe(true);
  });
  it('passengers keep colliding with everything else, including each other', () => {
    expect(touches(GROUP_PASSENGER, GROUP_BLOCK)).toBe(true);
    expect(touches(GROUP_PASSENGER, GROUP_PASSENGER)).toBe(true);
    expect(touches(GROUP_PASSENGER, GROUP_GROUND)).toBe(true);
    expect(touches(GROUP_BLOCK, GROUP_BLOCK)).toBe(true);
  });
  it('finds the whole contact-connected tower above its base, excluding neighbours', () => {
    expect(supportedAbove(cube(1, 0.9), [cube(2, 2.6), cube(3, 4.3), cube(4, 0.9, 4)])).toEqual([2, 3]);
  });
  it('the carried block follows the finger promptly, and its speed is capped', () => {
    expect(carryVelocity({ x: 0.1, y: 0, z: 0 }).x).toBeCloseTo(1.4);
    const far = carryVelocity({ x: 5, y: 5, z: 0 });
    expect(Math.hypot(far.x, far.y, far.z)).toBeCloseTo(CARRY_MAX);
  });
  it('over a tower only a hard flick throws', () => {
    const v = { x: 4, y: 0, z: 0 }; // between THROW_MIN and FLICK_SPEED
    expect(4).toBeGreaterThan(THROW_MIN);
    expect(4).toBeLessThan(FLICK_SPEED);
    expect(throwVelocity(v)).not.toBeNull();
    expect(throwVelocity(v, FLICK_SPEED)).toBeNull();
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