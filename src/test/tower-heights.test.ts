import { describe, expect, it } from 'vitest';
import { frameFor } from '@/game/framing';
import { computeCarry, pickBlock, type Other } from '@/game/placement';
import { BLOCK_SCALE as S, CAMERA_FOV, FRAME_DIST_MAX, HOVER_GAP, REST_GAP, RUG_H, SAFE_EDGE } from '@/game/shapes';

// Building must behave the same at every height: the camera, the aim, the fit and the put-down are checked for
// towers of 1 to 14 cubes (the green cube that was hard to place was the 6th).
const id = { x: 0, y: 0, z: 0, w: 1 };
const tower = (n: number): Other[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, kind: 'cube' as const, x: 0, y: RUG_H + (i + 0.5) * S, z: 0, q: id }));
const boxesOf = (t: Other[]) => t.map((o) => ({ x: o.x, y: o.y, z: o.z, hx: 0.5 * S, hy: 0.5 * S, hz: 0.5 * S }));
const heights = Array.from({ length: 14 }, (_, i) => i + 1);

// A small pinhole camera, to project points the way the screen does.
function project(cam: { px: number; py: number; pz: number; tx: number; ty: number; tz: number }, aspect: number, p: [number, number, number]) {
  const f = [cam.tx - cam.px, cam.ty - cam.py, cam.tz - cam.pz];
  const fl = Math.hypot(f[0]!, f[1]!, f[2]!);
  const fw = f.map((v) => v / fl) as [number, number, number];
  let r: [number, number, number] = [fw[2], 0, -fw[0]]; // forward x up(0,1,0)
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u: [number, number, number] = [r[1] * fw[2] - r[2] * fw[1], r[2] * fw[0] - r[0] * fw[2], r[0] * fw[1] - r[1] * fw[0]];
  const v: [number, number, number] = [p[0] - cam.px, p[1] - cam.py, p[2] - cam.pz];
  const x = v[0] * r[0] + v[1] * r[1] + v[2] * r[2];
  const y = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  const z = v[0] * fw[0] + v[1] * fw[1] + v[2] * fw[2];
  const tanV = Math.tan((CAMERA_FOV * Math.PI) / 360);
  return { x: x / (z * tanV * aspect), y: y / (z * tanV), z };
}

function cameraFor(n: number, aspect: number) {
  const t = tower(n);
  const pitch = 0.7, az = 0.5;
  const fr = frameFor(boxesOf(t), aspect, CAMERA_FOV, pitch);
  const d = fr.distance;
  return {
    fr,
    cam: { px: fr.cx + d * Math.cos(pitch) * Math.sin(az), py: fr.cy + d * Math.sin(pitch), pz: fr.cz + d * Math.cos(pitch) * Math.cos(az), tx: fr.cx, ty: fr.cy, tz: fr.cz },
  };
}

describe('building at every tower height', () => {
  it('the camera distance changes little from one block to the next, and never explodes (steady while building)', () => {
    let prev: number | null = null;
    for (const n of heights) {
      const dist = frameFor(boxesOf(tower(n)), 0.46, CAMERA_FOV).distance; // a portrait phone
      expect(dist).toBeLessThan(FRAME_DIST_MAX);
      if (prev !== null) expect(dist / prev).toBeLessThan(1.1);
      prev = dist;
    }
  });

  it('the whole tower, with room above it for the next block, is on screen at every height (portrait and landscape)', () => {
    for (const aspect of [0.46, 1.8]) {
      for (const n of heights) {
        const { cam } = cameraFor(n, aspect);
        const top = RUG_H + n * S;
        for (const p of [[0, 0, 0], [0, top + S, 0], [-0.5 * S, top, -0.5 * S], [0.5 * S, top, 0.5 * S]] as [number, number, number][]) {
          const q = project(cam, aspect, p);
          expect(Math.abs(q.x)).toBeLessThan(1);
          expect(Math.abs(q.y)).toBeLessThan(1);
        }
      }
    }
  });

  it('a carried cube hovers just above the top block, and is put down on a stable spot, at every height', () => {
    for (const n of heights) {
      const t = tower(n);
      const top = RUG_H + n * S;
      const r = computeCarry({ kind: 'cube', x: 0.15 * S, z: -0.1 * S, yaw: 0, heldY: top + S, stickyId: null, others: t });
      expect(r.supportId).toBe(n); // the top block, not a lower one
      expect(r.top).toBeCloseTo(top, 6);
      expect(r.y).toBeCloseTo(top + 0.5 * S + HOVER_GAP, 6);
      expect(Math.abs(r.rest?.x ?? r.x)).toBeLessThanOrEqual(0.5 * S - SAFE_EDGE * S + 1e-6);
      expect(r.top + 0.5 * S + REST_GAP).toBeGreaterThan(top + 0.5 * S); // put down just touching, not dropped from far
    }
  });

  it('pointing at the tower top from the camera picks the top block at every height, also slightly beside it', () => {
    for (const n of heights) {
      const t = tower(n);
      const { cam } = cameraFor(n, 0.46);
      const top = RUG_H + n * S;
      const aimAt = (px: number, py: number, pz: number) => {
        const dx = px - cam.px, dy = py - cam.py, dz = pz - cam.pz;
        const l = Math.hypot(dx, dy, dz);
        return [dx / l, dy / l, dz / l] as const;
      };
      const [dx, dy, dz] = aimAt(0, top - 0.3 * S, 0); // the top block's image
      const hit = pickBlock(cam.px, cam.py, cam.pz, dx, dy, dz, t, top + 2 * S, Infinity, 0.3 * S);
      expect(hit?.id).toBe(n);
      // slightly beside (about a fifth of a block): still counts with the margin
      const [bx, by, bz] = aimAt(0.7 * S, top - 0.3 * S, 0);
      const beside = pickBlock(cam.px, cam.py, cam.pz, bx, by, bz, t, top + 2 * S, Infinity, 0.3 * S);
      expect(beside?.id).toBe(n);
    }
  });
});
