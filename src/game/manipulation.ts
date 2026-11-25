import { CARRY_GAIN, CARRY_MAX, GRAVITY, LOAD_ACCEL, THROW_MIN, THROW_MAX, TILT_MAX, TILT_PER_SPEED } from './shapes';
import { worldHalf, type Other } from './placement';

export interface Velocity { x: number; y: number; z: number }
export interface MotionSample { time: number; x: number; z: number }
export const GESTURE_WINDOW_MS = 120;

/** Contact-connected blocks above the grabbed body, not rigidly attached passengers. */
export function supportedAbove(base: Other, others: Other[]): number[] {
  const supports = [base];
  const found = new Set<number>();
  for (let i = 0; i < supports.length; i++) {
    const support = supports[i];
    if (!support) continue;
    const [sx, sy, sz] = worldHalf(support.kind, support.q);
    for (const o of others) {
      if (found.has(o.id) || o.id === base.id) continue;
      const [ox, oy, oz] = worldHalf(o.kind, o.q);
      const gap = o.y - oy - (support.y + sy);
      if (o.y > support.y && Math.abs(gap) < 0.16 &&
          Math.abs(o.x - support.x) < sx + ox - 0.12 &&
          Math.abs(o.z - support.z) < sz + oz - 0.12) {
        found.add(o.id);
        supports.push(o);
      }
    }
  }
  return [...found];
}

/** Recent finger intent, independent of rendering speed or collision-stalled body speed. */
export function gestureVelocity(samples: MotionSample[], now: number): Velocity {
  const recent = samples.filter(s => now - s.time <= GESTURE_WINDOW_MS);
  const first = recent[0], last = recent[recent.length - 1];
  if (!first || !last || last.time <= first.time || now - last.time > 80) return { x: 0, y: 0, z: 0 };
  const dt = (last.time - first.time) / 1000;
  return { x: (last.x - first.x) / dt, y: 0, z: (last.z - first.z) / dt };
}

/** Launch velocity of a release, or null for a gentle place. `minSpeed` lets the caller demand a harder flick. */
export function throwVelocity(v: Velocity, minSpeed = THROW_MIN): Velocity | null {
  const speed = Math.hypot(v.x, v.z);
  if (speed < minSpeed) return null;
  const arc = Math.min(2.5, speed * 0.1);
  const length = Math.hypot(v.x, arc, v.z);
  const scale = Math.min(1, THROW_MAX / length);
  return { x: v.x * scale, y: arc * scale, z: v.z * scale };
}

/**
 * Velocity that steers the carried block towards its target: proportional and capped. The block follows the
 * finger promptly (so lifting and stacking feel direct); a stack riding on it is carried by friction, and a
 * sudden jerk leaves it behind.
 */
export function carryVelocity(error: Velocity): Velocity {
  const x = error.x * CARRY_GAIN, y = error.y * CARRY_GAIN, z = error.z * CARRY_GAIN;
  const speed = Math.hypot(x, y, z);
  const k = speed > CARRY_MAX ? CARRY_MAX / speed : 1;
  return { x: x * k, y: y * k, z: z * k };
}

/**
 * How a carried block leans: the top goes with the motion, like a weight hanging from the finger. Returns the
 * (horizontal) rotation axis and angle; `cap` limits the angle (small right above a support, so its corner
 * never dips into the block below).
 */
export function leanFor(v: Velocity, cap = TILT_MAX): { x: number; z: number; angle: number } {
  const speed = Math.hypot(v.x, v.z);
  if (speed < 0.2) return { x: 0, z: 0, angle: 0 };
  return { x: v.z / speed, z: -v.x / speed, angle: Math.min(cap, TILT_MAX, speed * TILT_PER_SPEED) };
}

/**
 * Largest acceleration with which a block carrying a stack of `passengers` blocks may be moved. A stack of n blocks
 * tips when pushed harder than about g / n (centre of mass n/2 blocks above the base, half a block from its edge),
 * so this scales with 1 / n: the taller the tower, the more carefully it is moved.
 */
export function loadAccel(passengers: number): number {
  return Math.min(0.8 * GRAVITY, (LOAD_ACCEL * GRAVITY) / Math.max(1, passengers));
}

/** Steps the commanded velocity `cmd` towards `want`, changing it by at most `maxAccel * dt`. */
export function limitAccel(cmd: Velocity, want: Velocity, maxAccel: number, dt: number): Velocity {
  const dx = want.x - cmd.x, dy = want.y - cmd.y, dz = want.z - cmd.z;
  const len = Math.hypot(dx, dy, dz);
  const lim = maxAccel * dt;
  if (len <= lim || len < 1e-9) return { x: want.x, y: want.y, z: want.z };
  const k = lim / len;
  return { x: cmd.x + dx * k, y: cmd.y + dy * k, z: cmd.z + dz * k };
}
