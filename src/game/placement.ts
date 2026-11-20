// Pure placement maths for carrying and stacking blocks. No React, no three.js, no physics engine:
// everything is plain numbers so it can be unit-tested.
import {
  BLOCK_SCALE, ARENA_MARGIN, DRAG_LIFT, HOVER_GAP, PLAY_AREA, RUG_H, SNAP_RANGE, SNAP_STEP,
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
    return finish(r, kind, heldY, others);
  }

  const y = best.top + hy + HOVER_GAP;
  if (!best.flat) {
    return finish({ x, z, y, yaw: gy, top: best.top, supportId: best.o.id, snapped: false }, kind, heldY, others);
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
  return finish({
    x: o.x + c * lx + s * lz,
    z: o.z - s * lx + c * lz,
    y, yaw, top: best.top, supportId: o.id, snapped: snapX && snapZ,
  }, kind, heldY, others);
}

function finish(r: CarryResult, kind: ShapeKind, heldY: number, others: Other[]): CarryResult {
  return clampArena(separate(r, kind, heldY, others), kind);
}

/** Keep the whole footprint inside the play area (a flat camera angle can aim the finger far beyond the rug). */
export function clampArena(r: CarryResult, kind: ShapeKind): CarryResult {
  const [hx, , hz] = halfExtents(kind);
  const c = Math.abs(Math.cos(r.yaw)), s = Math.abs(Math.sin(r.yaw));
  const fx = c * hx + s * hz, fz = s * hx + c * hz;
  const d = Math.hypot(r.x, r.z);
  if (d < 1e-6) return r;
  const reach = fx * (Math.abs(r.x) / d) + fz * (Math.abs(r.z) / d); // footprint extent towards the wall
  const limit = Math.max(0, PLAY_AREA - ARENA_MARGIN - reach);
  if (d <= limit) return r;
  const k = limit / d;
  return { ...r, x: r.x * k, z: r.z * k, snapped: false };
}

export interface Pick { id: number; x: number; z: number; top: number }

/**
 * What is the finger pointing at? Casts the view ray through the bounding boxes of the other blocks and
 * returns the nearest one hit, with the spot of its top face the finger is aiming at (clamped onto the face
 * when the ray enters through the side). This is the "intent": pointing at a tower means "put it up there".
 */
export function pickBlock(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  others: Other[], heldY: number, maxT = Infinity,
): Pick | null {
  if (dy >= -1e-6) return null; // the view ray always points down at the playroom
  let best: { o: Other; t: number; ax: number; ay: number; az: number } | null = null;
  for (const o of others) {
    const [ax, ay, az] = worldHalf(o.kind, o.q);
    if (o.y - ay >= heldY) continue; // sits on / above the carried block
    let t0 = 0, t1 = Infinity;
    const slab = (p: number, d: number, c: number, h: number) => {
      if (Math.abs(d) < 1e-9) return p >= c - h && p <= c + h;
      let a = (c - h - p) / d, b = (c + h - p) / d;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      return t0 <= t1;
    };
    if (!slab(ox, dx, o.x, ax) || !slab(oy, dy, o.y, ay) || !slab(oz, dz, o.z, az)) continue;
    if (t0 > maxT) continue; // only blocks the finger sees BEFORE the floor point it would otherwise aim at
    if (!best || t0 < best.t) best = { o, t: t0, ax, ay, az };
  }
  if (!best) return null;
  const { o, ax, ay, az } = best;
  const top = o.y + ay;
  const tt = (top - oy) / dy;
  const px = Math.min(o.x + ax, Math.max(o.x - ax, ox + dx * tt));
  const pz = Math.min(o.z + az, Math.max(o.z - az, oz + dz * tt));
  return { id: o.id, x: px, z: pz, top };
}

/**
 * The place where the block will end up must not overlap another block sideways (it would pop out on release).
 * Any block that is level with the TARGET height is an obstacle and the target is pushed out of it. The carried
 * block itself does not collide with other blocks, so this is the only thing keeping them apart.
 */
function separate(r: CarryResult, kind: ShapeKind, heldY: number, others: Other[]): CarryResult {
  const [hx, hy, hz] = halfExtents(kind);
  const c = Math.abs(Math.cos(r.yaw)), s = Math.abs(Math.sin(r.yaw));
  const fx = c * hx + s * hz, fz = s * hx + c * hz;
  const lo = r.y - hy, hi = r.y + hy;
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

/** Would a block of this kind, placed at this pose, intersect any other block? (bounding boxes, small tolerance) */
export function overlapsOther(kind: ShapeKind, x: number, y: number, z: number, yaw: number, others: Other[]): boolean {
  const [hx, hy, hz] = halfExtents(kind);
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const fx = c * hx + s * hz, fz = s * hx + c * hz;
  const tol = 0.04;
  for (const o of others) {
    const [ax, ay, az] = worldHalf(o.kind, o.q);
    if (Math.abs(x - o.x) < fx + ax - tol && Math.abs(z - o.z) < fz + az - tol && Math.abs(y - o.y) < hy + ay - tol) return true;
  }
  return false;
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
