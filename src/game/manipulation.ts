import { CARRY_GAIN, CARRY_MAX, THROW_MIN, THROW_MAX } from './shapes';
import { worldHalf, type Other } from './placement';

export interface Velocity { x: number; y: number; z: number }
export interface MotionSample { time: number; x: number; z: number }
export const GESTURE_WINDOW_MS = 120;
export const SLOW_ACCEL = 2.5;
export const FAST_ACCEL = 90;

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

export function throwVelocity(v: Velocity): Velocity | null {
  const speed = Math.hypot(v.x, v.z);
  if (speed < THROW_MIN) return null;
  const arc = Math.min(2.5, speed * 0.1);
  const length = Math.hypot(v.x, arc, v.z);
  const scale = Math.min(1, THROW_MAX / length);
  return { x: v.x * scale, y: arc * scale, z: v.z * scale };
}

/** Acceleration-limited hand: slow movement transfers through friction, jerks leave the stack behind. */
export function carryImpulse(error: Velocity, velocity: Velocity, dt: number, fast: boolean, mass: number): Velocity {
  const target = { x: error.x * CARRY_GAIN, y: error.y * CARRY_GAIN, z: error.z * CARRY_GAIN };
  const speed = Math.hypot(target.x, target.y, target.z);
  const k = Math.min(1, CARRY_MAX / Math.max(speed, 1e-6));
  const diff = { x: target.x * k - velocity.x, y: target.y * k - velocity.y, z: target.z * k - velocity.z };
  const limit = (fast ? FAST_ACCEL : SLOW_ACCEL) * Math.min(dt, 0.05);
  const scale = Math.min(1, limit / Math.max(Math.hypot(diff.x, diff.y, diff.z), 1e-6)) * mass;
  return { x: diff.x * scale, y: Math.max(-FAST_ACCEL * Math.min(dt, 0.05), Math.min(FAST_ACCEL * Math.min(dt, 0.05), diff.y)) * mass, z: diff.z * scale };
}