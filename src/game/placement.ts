// Pure placement maths for carrying and stacking blocks. No React, no three.js, no physics engine:
// everything is plain numbers so it can be unit-tested.
import {
  BLOCK_SCALE, ARENA_MARGIN, CONTACT_EPS, DRAG_LIFT, HOVER_GAP, PLAY_AREA, RUG_H, SAFE_EDGE, SNAP_EDGE_BIAS, SNAP_HARD, SNAP_RANGE, SNAP_STEP,
  SPAWN_HEIGHT, SPAWN_RADIUS, SUPPORT_KEEP, SUPPORT_OVERLAP, TILT_OK, halfExtents, shapeDef, type ShapeKind,
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
  /** How far above the rug a block on the floor floats while carried (a block with a stack on it floats hardly at all). */
  lift?: number;
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
  /**
   * Where to put the block down on a tower: like x / z, but with the centre of mass pulled over the support. While
   * carrying, the block follows the finger smoothly even past the edge; on release it goes here, so it stays up.
   */
  rest?: { x: number; z: number };
}

/**
 * Where should a carried block hover? Above the highest block under its footprint (never inside it),
 * turned to match that block, and pulled onto a half-cube grid when it is on a flat top.
 */
export function computeCarry(input: CarryInput): CarryResult {
  const { kind, x, z, heldY, others, stickyId } = input;
  const lift = input.lift ?? DRAG_LIFT;
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
    const r: CarryResult = { x, z, y: RUG_H + hy + lift, yaw: gy, top: RUG_H, supportId: null, snapped: false };
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
  const lx0 = c * dx - s * dz, lz0 = s * dx + c * dz;
  // Carried footprint in the support's own frame, and the support's half extents.
  const swap = Math.abs(Math.round((yawPref - oyaw) / HALF_PI)) % 2 === 1;
  const [ohx, , ohz] = halfExtents(o.kind);
  const ax = snapAxis(lx0, swap ? hz : hx, ohx, true);
  const az = snapAxis(lz0, swap ? hx : hz, ohz, true);
  const r0: CarryResult = {
    x: o.x + c * ax.v + s * az.v,
    z: o.z - s * ax.v + c * az.v,
    y, yaw, top: best.top, supportId: o.id, snapped: ax.locked && az.locked,
    rest: { x: o.x + c * ax.rest + s * az.rest, z: o.z - s * ax.rest + c * az.rest },
  };
  const out = finish(r0, kind, heldY, others);
  // If a neighbour or the rim moved the block, the stable spot is no longer valid: only the plain position counts.
  if (out.x !== r0.x || out.z !== r0.z) {
    const { rest: _unused, ...plain } = out;
    return plain;
  }
  return out;
}

/**
 * Magnet along one axis of a support / neighbour. `l` is where the carried block's centre wants to be relative to
 * the other block's centre, `h` its half size, `s` the other block's half size. Candidates: centred, edges flush
 * (carried edge level with the other block's edge) and, on a top, the half-cube grid. Exact inside the inner
 * zone, easing off to nothing at the edge of the range, so the block slides into place instead of jumping.
 */
function snapAxis(l: number, h: number, s: number, onTop: boolean): { v: number; locked: boolean; rest: number } {
  const range = SNAP_RANGE * BLOCK_SCALE;
  // On a top the centre of mass must stay over the support: a block whose centre sits on (or beyond) the edge tips
  // off, and the higher the tower, the sooner. Candidates and the result are therefore kept inside this limit.
  const lim = onTop ? Math.max(0, s - SAFE_EDGE * BLOCK_SCALE) : Infinity;
  const grid = onTop;
  let bestC = l, bestScore = Infinity, bestD = Infinity;
  const consider = (c: number, bias: number) => {
    if (Math.abs(c) > lim + 1e-9) return; // would not stay on the support
    const d = Math.abs(l - c);
    if (d >= range) return; // out of reach: not a candidate
    if (d * bias < bestScore) { bestScore = d * bias; bestC = c; bestD = d; }
  };
  consider(0, SNAP_EDGE_BIAS);
  consider(s - h, SNAP_EDGE_BIAS);
  consider(-(s - h), SNAP_EDGE_BIAS);
  if (grid) {
    const step = SNAP_STEP * BLOCK_SCALE;
    consider(Math.round(l / step) * step, 1);
  }
  const clampSafe = (v: number) => Math.max(-lim, Math.min(lim, v));
  // While carrying, the pull towards the safe zone eases in between `lim` and the point where the block loses its
  // support entirely (zoneEnd): continuous, so the block never hops when the finger leaves the tower.
  const zoneEnd = s + h; // the block loses its support when it has left the top completely
  const soft = (v: number) => {
    const a = Math.abs(v);
    if (a <= lim) return v;
    const t = Math.min(1, (a - lim) / Math.max(1e-6, zoneEnd - lim));
    const w = t * t * (3 - 2 * t);
    const hard = Math.sign(v) * lim;
    return hard + (v - hard) * w;
  };
  if (bestScore === Infinity) return { v: soft(l), locked: false, rest: clampSafe(l) };
  const inner = range * SNAP_HARD;
  if (bestD <= inner) return { v: bestC, locked: true, rest: bestC };
  const t = (range - bestD) / (range - inner); // 1 -> 0 across the easing zone
  const w = t * t * (3 - 2 * t);
  const v = l + (bestC - l) * w;
  return { v: soft(v), locked: false, rest: clampSafe(v) };
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
 * Side-by-side placement. Any block level with the TARGET height is a neighbour: if the carried block overlaps
 * it, it is pushed out; if it is within magnet range, it is pulled in until the faces touch exactly. Along the
 * touching face the block is aligned to the neighbour's edges or centre. The carried block itself does not
 * collide with other blocks, so this is also what keeps them from overlapping (it would pop out on release).
 */
function separate(r: CarryResult, kind: ShapeKind, heldY: number, others: Other[]): CarryResult {
  const [hx, hy, hz] = halfExtents(kind);
  const c = Math.abs(Math.cos(r.yaw)), s = Math.abs(Math.sin(r.yaw));
  const fx = c * hx + s * hz, fz = s * hx + c * hz;
  const lo = r.y - hy, hi = r.y + hy;
  const range = SNAP_RANGE * BLOCK_SCALE;
  let px = r.x, pz = r.z, moved = false, locked = false;
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const o of others) {
      const [ax, ay, az] = worldHalf(o.kind, o.q);
      if (o.y - ay >= heldY) continue; // resting on / above the carried block
      if (o.y + ay <= lo + 0.02 || o.y - ay >= hi) continue; // not level with it
      const ox = fx + ax - Math.abs(px - o.x), oz = fz + az - Math.abs(pz - o.z); // > 0: overlapping on that axis
      // After the first pass only real overlaps are resolved: the soft pull must not be applied again and again.
      if (pass > 0 && !(ox > 0 && oz > 0)) continue;
      let axis: "x" | "z" | null = null;
      if (ox > 0 && oz > 0) axis = ox < oz ? "x" : "z";
      else if (ox > 0 && oz > -range) axis = "z";
      else if (oz > 0 && ox > -range) axis = "x";
      if (!axis) continue;
      // Overlapping: pushed out to exact contact. Merely near: pulled in with a strength that is full close to the
      // neighbour and fades to nothing at the edge of the range, so the pull never makes the block jump.
      const overlapping = ox > 0 && oz > 0;
      const gap = Math.max(0, -(axis === "x" ? ox : oz));
      const inner = range * SNAP_HARD;
      let w = 1;
      if (!overlapping && gap > inner) {
        const t = Math.max(0, (range - gap) / (range - inner));
        w = t * t * (3 - 2 * t);
      }
      if (axis === "x") {
        px = o.x + (px >= o.x ? 1 : -1) * (fx + ax + CONTACT_EPS + gap * (1 - w)); // faces touching (or nearly)
        const a = snapAxis(pz - o.z, fz, az, false);
        pz = o.z + (pz - o.z) + (a.v - (pz - o.z)) * w;
        locked = a.locked && w === 1;
      } else {
        pz = o.z + (pz >= o.z ? 1 : -1) * (fz + az + CONTACT_EPS + gap * (1 - w));
        const a = snapAxis(px - o.x, fx, ax, false);
        px = o.x + (px - o.x) + (a.v - (px - o.x)) * w;
        locked = a.locked && w === 1;
      }
      any = moved = true;
    }
    if (!any) break;
  }
  return moved ? { ...r, x: px, z: pz, snapped: locked } : r;
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

export interface Vec3 { x: number; y: number; z: number }

/**
 * Moves a box (half extents `half`) from `from` towards `to` WITHOUT ever entering another block: it stops at the
 * first contact and slides along it, like a character controller. The carried block does not collide physically
 * (it must never shove the castle), so this is what stops it passing through other blocks: it rises along a tower
 * until it clears the top, and a quick swipe across a block cannot jump to the far side. Blocks resting on / above
 * the carried one (its passengers) are not obstacles. A block it already overlaps at the start does not hold it.
 */
export function sweepMove(from: Vec3, to: Vec3, half: [number, number, number], others: Other[], heldY: number): Vec3 {
  const boxes: { c: [number, number, number]; e: [number, number, number] }[] = [];
  for (const o of others) {
    const [ax, ay, az] = worldHalf(o.kind, o.q);
    if (o.y - ay >= heldY) continue;
    boxes.push({ c: [o.x, o.y, o.z], e: [ax + half[0], ay + half[1], az + half[2]] });
  }
  const p: [number, number, number] = [from.x, from.y, from.z];
  const rem: [number, number, number] = [to.x - from.x, to.y - from.y, to.z - from.z];
  const EPS = 1e-3, SKIN = 0.002;
  for (let iter = 0; iter < 3; iter++) {
    const len = Math.hypot(rem[0], rem[1], rem[2]);
    if (len < 1e-6) break;
    let tHit = 1, axis = -1;
    for (const b of boxes) {
      const d: [number, number, number] = [p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2]];
      if (Math.abs(d[0]) < b.e[0] - EPS && Math.abs(d[1]) < b.e[1] - EPS && Math.abs(d[2]) < b.e[2] - EPS) continue;
      let t0 = -Infinity, t1 = Infinity, ax = -1, miss = false;
      for (let i = 0; i < 3; i++) {
        const ri = rem[i]!, di = d[i]!, ei = b.e[i]!;
        if (Math.abs(ri) < 1e-9) {
          if (Math.abs(di) >= ei) { miss = true; break; }
          continue;
        }
        let a = (-ei - di) / ri, c = (ei - di) / ri;
        if (a > c) { const tmp = a; a = c; c = tmp; }
        if (a > t0) { t0 = a; ax = i; }
        if (c < t1) t1 = c;
      }
      if (miss || ax < 0 || t0 > t1 || t0 < -1e-6 || t0 >= 1) continue;
      if (t0 < tHit) { tHit = Math.max(0, t0); axis = ax; }
    }
    if (axis < 0) {
      for (let i = 0; i < 3; i++) p[i] = p[i]! + rem[i]!;
      break;
    }
    const adv = Math.max(0, tHit - SKIN / len);
    for (let i = 0; i < 3; i++) p[i] = p[i]! + rem[i]! * adv;
    for (let i = 0; i < 3; i++) rem[i] = rem[i]! * (1 - tHit);
    rem[axis] = 0; // slide along the face that was hit
  }
  return { x: p[0], y: p[1], z: p[2] };
}

export interface SpawnOptions {
  /** Middle of what the camera shows (a floor point): new blocks appear around it. */
  anchor?: { x: number; z: number };
  /** True for floor points that are comfortably on screen (not under the tray, not at the edge). */
  accept?: (x: number, z: number) => boolean;
}

/** A free spot to drop a new block: in view, near the middle of it, away from the others, never on a tower if avoidable. */
export function pickSpawn(kind: ShapeKind, others: Other[], rand: () => number = Math.random, opts: SpawnOptions = {}): [number, number, number] {
  const [hx, hy, hz] = halfExtents(kind);
  const need = Math.hypot(hx, hz) + 0.3;
  const cx = opts.anchor?.x ?? 0, cz = opts.anchor?.z ?? 0;
  const R = opts.anchor ? BLOCK_SCALE * 2.6 : PLAY_AREA * SPAWN_RADIUS;
  const inner = PLAY_AREA - 1.5 - Math.hypot(hx, hz); // stay well inside the rim
  let bestPos: [number, number] = [0, 0];
  let found = false;
  let bestClear = -Infinity;
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R;
    let px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
    const d = Math.hypot(px, pz);
    if (d > inner) { px *= inner / d; pz *= inner / d; }
    if (opts.accept && !opts.accept(px, pz)) continue;
    let clear = Infinity;
    for (const o of others) {
      const [ohx, , ohz] = halfExtents(o.kind);
      clear = Math.min(clear, Math.hypot(px - o.x, pz - o.z) - Math.hypot(ohx, ohz));
    }
    if (clear > bestClear) { bestClear = clear; bestPos = [px, pz]; found = true; }
    if (clear >= need) break;
  }
  if (!found) {
    // nothing acceptable on screen: the anchor itself (or the middle of the rug)
    const d = Math.hypot(cx, cz);
    bestPos = d > inner ? [cx * inner / d, cz * inner / d] : [cx, cz];
    bestClear = -Infinity;
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
