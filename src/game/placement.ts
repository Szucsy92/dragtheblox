// Pure placement maths for carrying and stacking blocks. No React, no three.js, no physics engine:
// everything is plain numbers so it can be unit-tested.
import {
  BLOCK_SCALE, DRAG_LIFT, HOVER_GAP, PLAY_AREA, RUG_H, SNAP_RANGE, SNAP_STEP,
  SPAWN_HEIGHT, SUPPORT_KEEP, SUPPORT_OVERLAP, TILT_OK, halfExtents, shapeDef, type ShapeKind,
} from "./shapes";

export const HALF_PI = Math.PI / 2;

export interface Quat { x: number; y: number; z: number; w: number }
/** Snapshot of another block's pose. */
export interface Other { id: number; kind: ShapeKind; x: number; y: number; z: number; q: Quat }

/** Rotation about Y of the body's local x axis (0 for an unrotated block). */
export function quatYaw(q: Quat): number {
  const vx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const vz = 2 * (q.x * q.z - q.y * q.w);
  return Math.atan2(-vz, vx);
}

/** How vertical the block's own up axis is (1 = upright, 0 = lying on its side). */
export function uprightness(q: Quat): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

/** Half extents of the world-axis bounding box of a rotated block. */
export function worldHalf(kind: ShapeKind, q: Quat): [number, number, number] {
  const [hx, hy, hz] = halfExtents(kind);
  const { x, y, z, w } = q;
  const r00 = Math.abs(1 - 2 * (y * y + z * z)), r01 = Math.abs(2 * (x * y - z * w)), r02 = Math.abs(2 * (x * z + y * w));
  const r10 = Math.abs(2 * (x * y + z * w)), r11 = Math.abs(1 - 2 * (x * x + z * z)), r12 = Math.abs(2 * (y * z - x * w));
  const r20 = Math.abs(2 * (x * z - y * w)), r21 = Math.abs(2 * (y * z + x * w)), r22 = Math.abs(1 - 2 * (x * x + y * y));
  return [r00 * hx + r01 * hy + r02 * hz, r10 * hx + r11 * hy + r12 * hz, r20 * hx + r21 * hy + r22 * hz];
}

const gridYaw = (yaw: number) => Math.round(yaw / HALF_PI) * HALF_PI;

export interface CarryInput {
  kind: ShapeKind;
  /** Where the finger wants the block centre (x, z). */
  x: number;
  z: number;
  /** Preferred yaw (the player's own turning); it is aligned to the 90° grid or to the support below. */
  yaw: number;
  /** Current centre height of the carried block. */
  heldY: number;
  /** Support chosen on the previous frame: it is kept with less overlap (hysteresis, no flicker at the edge). */
  stickyId: number | null;
  others: Other[];
}

export interface CarryResult {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Height of the surface the block would land on (rug or top of a block). */
  top: number;
  supportId: number | null;
  /** True when the magnet locked the block onto the grid of a flat top. */
  snapped: boolean;
}

/**
 * Where should a carried block hover? Above the highest block under its footprint (never inside it),
 * turned to match that block, and pulled onto a half-cube grid when it is on a flat top.
 */
export function computeCarry(input: CarryInput): CarryResult {
  const { kind, x, z, heldY, others, stickyId } = input;
  const [hx, hy, hz] = halfExtents(kind);
  const yawPref = input.yaw;

  const gy = gridYaw(yawPref);
  const gc = Math.abs(Math.cos(gy)), gs = Math.abs(Math.sin(gy));
  const wfx = gc * hx + gs * hz, wfz = gs * hx + gc * hz; // world-axis footprint of the carried block

  let best: { o: Other; top: number; frac: number; flat: boolean } | null = null;

  for (const o of others) {
    const [ohx, , ohz] = halfExtents(o.kind);
    const [ax, ay, az] = worldHalf(o.kind, o.q);
    const top = o.y + ay;
    // Blocks that rest on top of the carried one (or float above it) are never a support.
    if (o.y - ay >= heldY) continue;

    const flat = shapeDef(o.kind).flatTop && uprightness(o.q) > TILT_OK;
    let frac: number;
    if (flat) {
      const oyaw = quatYaw(o.q);
      const k = Math.round((yawPref - oyaw) / HALF_PI);
      const swap = Math.abs(k) % 2 === 1;
      const fxl = swap ? hz : hx, fzl = swap ? hx : hz; // carried footprint in the support's own frame
      const c = Math.cos(oyaw), s = Math.sin(oyaw);
      const dx = x - o.x, dz = z - o.z;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      const ovX = Math.min(lx + fxl, ohx) - Math.max(lx - fxl, -ohx);
      const ovZ = Math.min(lz + fzl, ohz) - Math.max(lz - fzl, -ohz);
      if (ovX <= 0 || ovZ <= 0) continue;
      frac = (ovX * ovZ) / (4 * fxl * fzl);
    } else {
      const ovX = Math.min(x + wfx, o.x + ax) - Math.max(x - wfx, o.x - ax);
      const ovZ = Math.min(z + wfz, o.z + az) - Math.max(z - wfz, o.z - az);
      if (ovX <= 0 || ovZ <= 0) continue;
      frac = (ovX * ovZ) / (4 * wfx * wfz);
    }
    if (frac < (o.id === stickyId ? SUPPORT_KEEP : SUPPORT_OVERLAP)) continue;
    if (!best || top > best.top + 0.02 || (Math.abs(top - best.top) <= 0.02 && frac > best.frac)) {
      best = { o, top, frac, flat };
    }
  }

  if (!best) {
    const r: CarryResult = { x, z, y: RUG_H + hy + DRAG_LIFT, yaw: gy, top: RUG_H, supportId: null, snapped: false };
    return separate(r, kind, heldY, others);
  }

  const y = best.top + hy + HOVER_GAP;
  if (!best.flat) {
    return separate({ x, z, y, yaw: gy, top: best.top, supportId: best.o.id, snapped: false }, kind, heldY, others);
  }

  // Not yet above the top: rise first. No magnet yet; the finger position decides which side it waits on.
  const oyaw0 = quatYaw(best.o.q);
  if (heldY - hy < best.top - 0.01) {
    const yaw0 = oyaw0 + Math.round((yawPref - oyaw0) / HALF_PI) * HALF_PI;
    return separate({ x, z, y, yaw: yaw0, top: best.top, supportId: best.o.id, snapped: false }, kind, heldY, others);
  }

  // Flat top: copy the support's orientation and pull onto its half-cube grid.
  const o = best.o;
  const oyaw = quatYaw(o.q);
  const yaw = oyaw + Math.round((yawPref - oyaw) / HALF_PI) * HALF_PI;
  const c = Math.cos(oyaw), s = Math.sin(oyaw);
  const dx = x - o.x, dz = z - o.z;
  let lx = c * dx - s * dz, lz = s * dx + c * dz;
  const step = SNAP_STEP * BLOCK_SCALE, range = SNAP_RANGE * BLOCK_SCALE;
  const gx = Math.round(lx / step) * step, gz = Math.round(lz / step) * step;
  const snapX = Math.abs(lx - gx) < range, snapZ = Math.abs(lz - gz) < range;
  if (snapX) lx = gx;
  if (snapZ) lz = gz;
  return separate({
    x: o.x + c * lx + s * lz,
    z: o.z - s * lx + c * lz,
    y, yaw, top: best.top, supportId: o.id, snapped: snapX && snapZ,
  }, kind, heldY, others);
}

/**
 * The carried block must never overlap another block sideways (the physics would shove it away, or it would
 * pop out on release). Any block that is level with the carried one is an obstacle: the target is pushed out
 * of it. This also gives the "rise first, then slide on top" order: while the carried block's bottom is still
 * below a support's top, that support is an obstacle too.
 */
function separate(r: CarryResult, kind: ShapeKind, heldY: number, others: Other[]): CarryResult {
  const [hx, hy, hz] = halfExtents(kind);
  const c = Math.abs(Math.cos(r.yaw)), s = Math.abs(Math.sin(r.yaw));
  const fx = c * hx + s * hz, fz = s * hx + c * hz;
  const lo = Math.min(heldY, r.y) - hy, hi = Math.max(heldY, r.y) + hy;
  let px = r.x, pz = r.z, moved = false;
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const o of others) {
      const [ax, ay, az] = worldHalf(o.kind, o.q);
      if (o.y - ay >= heldY) continue; // resting on / above the carried block
      if (o.y + ay <= lo + 0.02 || o.y - ay >= hi) continue; // not level with it
      const ox = fx + ax - Math.abs(px - o.x), oz = fz + az - Math.abs(pz - o.z);
      if (ox <= 0 || oz <= 0) continue;
      if (ox < oz) px += (px >= o.x ? 1 : -1) * (ox + 0.02);
      else pz += (pz >= o.z ? 1 : -1) * (oz + 0.02);
      any = moved = true;
    }
    if (!any) break;
  }
  return moved ? { ...r, x: px, z: pz, snapped: false } : r;
}

/** A free spot to drop a new block: away from the others, never on top of a tower if avoidable. */
export function pickSpawn(kind: ShapeKind, others: Other[], rand: () => number = Math.random): [number, number, number] {
  const [hx, hy, hz] = halfExtents(kind);
  const need = Math.hypot(hx, hz) + 0.3;
  const R = PLAY_AREA * 0.55;
  let bestPos: [number, number] = [0, 0];
  let bestClear = -Infinity;
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    let clear = Infinity;
    for (const o of others) {
      const [ohx, , ohz] = halfExtents(o.kind);
      clear = Math.min(clear, Math.hypot(px - o.x, pz - o.z) - Math.hypot(ohx, ohz));
    }
    if (clear > bestClear) { bestClear = clear; bestPos = [px, pz]; }
    if (clear >= need) break;
  }
  // If the room is crowded, start above whatever is below so it never spawns inside another block.
  let y = RUG_H + hy + SPAWN_HEIGHT;
  if (bestClear < need) {
    for (const o of others) {
      const [ax, ay, az] = worldHalf(o.kind, o.q);
      if (Math.abs(bestPos[0] - o.x) < ax + hx && Math.abs(bestPos[1] - o.z) < az + hz) {
        y = Math.max(y, o.y + ay + hy + 1.2);
      }
    }
  }
  return [bestPos[0], y, bestPos[1]];
}
