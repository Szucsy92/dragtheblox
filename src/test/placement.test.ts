import { describe, expect, it } from "vitest";
import { clampArena, computeCarry, overlapsOther, pickBlock, pickSpawn, sweepMove, quatYaw, HALF_PI, type Other } from "@/game/placement";
import { BLOCK_SCALE as S, CONTACT_EPS, DRAG_LIFT, SAFE_EDGE, HOVER_GAP, PLAY_AREA, RUG_H } from "@/game/shapes";

const id = { x: 0, y: 0, z: 0, w: 1 };
const yawQ = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const cubeAt = (n: number, x: number, y: number, z: number, q = id): Other => ({ id: n, kind: "cube", x, y, z, q });

describe("computeCarry", () => {
  it("floats a block just above the rug, never inside it", () => {
    const r = computeCarry({ kind: "cube", x: 1, z: 1, yaw: 0, heldY: 1, stickyId: null, others: [] });
    expect(r.y).toBeCloseTo(RUG_H + 0.5 * S + DRAG_LIFT);
    expect(r.top).toBe(RUG_H);
  });

  it("hovers above a cube instead of entering it, and magnet-centres", () => {
    const base = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
    const r = computeCarry({ kind: "cube", x: 0.1, z: -0.08, yaw: 0, heldY: RUG_H + S + 0.5 * S + HOVER_GAP, stickyId: null, others: [base] });
    expect(r.supportId).toBe(1);
    expect(r.y).toBeCloseTo(RUG_H + S + 0.5 * S + HOVER_GAP);
    expect(r.snapped).toBe(true);
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(0);
  });

  it("ignores a block resting on top of the carried one", () => {
    const above = cubeAt(2, 0, RUG_H + 1.5 * S, 0);
    const r = computeCarry({ kind: "cube", x: 0, z: 0, yaw: 0, heldY: RUG_H + 0.5 * S, stickyId: null, others: [above] });
    expect(r.supportId).toBeNull();
  });

  it("uses the tallest support and aligns yaw to it (mod 90°)", () => {
    const low = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
    const tall = cubeAt(2, 0.2, RUG_H + 1.5 * S, 0, yawQ(0.3));
    const r = computeCarry({ kind: "cube", x: 0.1, z: 0, yaw: 0, heldY: 6, stickyId: null, others: [low, tall] });
    expect(r.supportId).toBe(2);
    expect(Math.abs(r.yaw - quatYaw(tall.q)) % HALF_PI).toBeLessThan(1e-6);
  });

  it("does not lift for a barely touching block", () => {
    const base = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
    const r = computeCarry({ kind: "cube", x: 0.95 * S, z: 0, yaw: 0, heldY: 1, stickyId: null, others: [base] });
    expect(r.supportId).toBeNull();
  });

  it("hovers above a tipped-over block using its real height, without snapping", () => {
    // brick lying on its end: 2*S tall
    const tilted: Other = { id: 3, kind: "brick", x: 0, y: RUG_H + S, z: 0, q: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } };
    const r = computeCarry({ kind: "cube", x: 0, z: 0, yaw: 0, heldY: 4, stickyId: null, others: [tilted] });
    expect(r.snapped).toBe(false);
    expect(r.top).toBeCloseTo(RUG_H + 2 * S);
  });
});

describe("climbing and sideways collisions", () => {
  const base = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
  it("goes straight on top of a support, even when it starts low (it does not collide, so it cannot shove)", () => {
    const low = RUG_H + 0.5 * S + DRAG_LIFT;
    const r = computeCarry({ kind: "cube", x: 0.3, z: 0, yaw: 0, heldY: low, stickyId: null, others: [base] });
    expect(r.supportId).toBe(1);
    expect(r.y).toBeCloseTo(RUG_H + S + 0.5 * S + HOVER_GAP);
    expect(Math.abs(r.x)).toBeLessThan(0.3 * S);
  });
  it("detects a block that sits inside another", () => {
    expect(overlapsOther("cube", 0.2, RUG_H + 0.5 * S, 0, 0, [base])).toBe(true);
    expect(overlapsOther("cube", 0, RUG_H + 1.5 * S + HOVER_GAP, 0, 0, [base])).toBe(false);
  });
  it("does not overlap a neighbour on the floor (no shoving, no pop on release)", () => {
    const r = computeCarry({ kind: "cube", x: 0.8 * S, z: 0, yaw: 0, heldY: RUG_H + 0.5 * S + DRAG_LIFT, stickyId: null, others: [base] });
    expect(Math.abs(r.x)).toBeGreaterThanOrEqual(S - 1e-6);
  });
  it("keeps the support with less overlap once chosen (hysteresis)", () => {
    const x = 0.5 * S + 0.38 * S; // ~12% overlap
    const fresh = computeCarry({ kind: "cube", x, z: 0, yaw: 0, heldY: 4, stickyId: null, others: [base] });
    const kept = computeCarry({ kind: "cube", x, z: 0, yaw: 0, heldY: 4, stickyId: 1, others: [base] });
    expect(fresh.supportId).toBeNull();
    expect(kept.supportId).toBe(1);
  });
});

describe("pickSpawn", () => {
  it("avoids existing blocks and is never inside one", () => {
    const others = [cubeAt(1, 0, RUG_H + 0.5 * S, 0), cubeAt(2, 1, RUG_H + 0.5 * S, 1)];
    const [x, y, z] = pickSpawn("cube", others);
    for (const o of others) expect(Math.hypot(x - o.x, z - o.z)).toBeGreaterThan(S);
    expect(y).toBeGreaterThan(RUG_H + S);
  });
});

describe("pickBlock (what the finger points at)", () => {
  // Keep the finger ray proportional to the blocks, looking 45° down at the tower.
  const tower = [cubeAt(1, 0, RUG_H + 0.5 * S, 0), cubeAt(2, 0, RUG_H + 1.5 * S, 0)];
  const d = Math.SQRT1_2;
  it("hits the tower from the front and aims at the front edge of its top", () => {
    const p = pickBlock(0, 5 * S / 1.7, 4 * S / 1.7, 0, -d, -d, tower, 9);
    expect(p?.id).toBe(2);
    if (!p) throw new Error('Missing tower hit');
    expect(p.top).toBeCloseTo(RUG_H + 2 * S);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(0.5 * S + 1e-9);
  });
  it("misses when the ray passes beside the tower", () => {
    expect(pickBlock(5, 5, 4, 0, -d, -d, tower, 9)).toBeNull();
  });
  it("ignores blocks that sit on top of the carried one", () => {
    expect(pickBlock(0, 5, 4, 0, -d, -d, tower, RUG_H + 0.5 * S)?.id).toBe(1);
  });
  it("a ray passing just beside a tall tower still counts as pointing at it, with a margin", () => {
    const near = pickBlock(0.5 * S + 0.2 * S, 5, 4, 0, -d, -d, tower, 9); // just outside the face
    expect(near).toBeNull();
    const generous = pickBlock(0.5 * S + 0.2 * S, 5, 4, 0, -d, -d, tower, 9, Infinity, 0.3 * S);
    expect(generous?.id).toBe(2);
    expect(Math.abs(generous!.x)).toBeLessThanOrEqual(0.5 * S + 1e-9); // the hit point is still on the real face
  });

  it("ignores blocks farther than maxT (behind the aimed floor point)", () => {
    expect(pickBlock(0, 5, 4, 0, -d, -d, tower, 9, 1)).toBeNull();
  });
});

describe("clampArena", () => {
  it("pulls a far-away aim back inside the rug, footprint included", () => {
    const r = clampArena({ x: 30, z: 0, y: 1, yaw: 0, top: RUG_H, supportId: null, snapped: false }, "cube");
    expect(r.x + 0.5 * S).toBeLessThanOrEqual(PLAY_AREA);
    expect(r.x).toBeGreaterThan(PLAY_AREA - 2 * S);
  });
  it("leaves positions inside the rug alone", () => {
    const r = clampArena({ x: 1, z: 1, y: 1, yaw: 0, top: RUG_H, supportId: null, snapped: false }, "cube");
    expect(r.x).toBe(1);
  });
});

describe("precise, realistic fits", () => {
  const cube0 = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
  const onTop = RUG_H + S + 0.5 * S + HOVER_GAP;

  it("locks exactly onto the centre inside the inner zone", () => {
    const r = computeCarry({ kind: "cube", x: 0.12 * S, z: -0.09 * S, yaw: 0, heldY: onTop, stickyId: null, others: [cube0] });
    expect(r.snapped).toBe(true);
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.z).toBeCloseTo(0, 9);
  });

  it("eases off smoothly: the block slides into the pocket instead of jumping", () => {
    let prev: number | null = null;
    let worst = 0;
    for (let x = 0; x <= 1.2 * S; x += 0.01) {
      const r = computeCarry({ kind: "cube", x, z: 0, yaw: 0, heldY: onTop, stickyId: 1, others: [cube0] });
      if (prev !== null) worst = Math.max(worst, Math.abs(r.x - prev));
      prev = r.x;
    }
    expect(worst).toBeLessThan(0.08);
  });

  it("pulls a block on the floor against its neighbour until the faces touch, aligned centre to centre", () => {
    const low = RUG_H + 0.5 * S + DRAG_LIFT;
    const r = computeCarry({ kind: "cube", x: 1.15 * S, z: 0.1, yaw: 0, heldY: low, stickyId: null, others: [cube0] });
    expect(r.x).toBeCloseTo(S + CONTACT_EPS, 9);
    expect(r.z).toBeCloseTo(0, 9);
    expect(r.snapped).toBe(true);
  });

  it("leaves a deliberate gap alone beyond the magnet range", () => {
    const low = RUG_H + 0.5 * S + DRAG_LIFT;
    const r = computeCarry({ kind: "cube", x: 1.4 * S, z: 0, yaw: 0, heldY: low, stickyId: null, others: [cube0] });
    expect(r.x).toBeCloseTo(1.4 * S, 9);
    expect(r.snapped).toBe(false);
  });

  it("aligns a brick's edge flush with a neighbour's edge", () => {
    // brick (half length S) next to a cube; edges flush when its centre is S - 0.5 S = 0.5 S off the cube's centre in z
    const low = RUG_H + 0.5 * S + DRAG_LIFT;
    const r = computeCarry({ kind: "brick", x: 1.15 * S, z: 0.45 * S, yaw: HALF_PI, heldY: low, stickyId: null, others: [cube0] });
    expect(r.z).toBeCloseTo(0.5 * S, 6);
  });
});

describe("sweepMove (the carried block cannot pass through other blocks)", () => {
  const half: [number, number, number] = [0.5 * S, 0.5 * S, 0.5 * S];
  const wall = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
  const lowY = RUG_H + 0.5 * S + DRAG_LIFT;

  it("stops at the face of a block instead of passing through to the other side", () => {
    const end = sweepMove({ x: -3 * S, y: lowY, z: 0 }, { x: 3 * S, y: lowY, z: 0 }, half, [wall], lowY);
    expect(end.x).toBeLessThanOrEqual(-S + 1e-6); // stopped in front of the block (its face is at -0.5 S, plus the half size)
    expect(end.x).toBeGreaterThan(-S - 0.05);
  });

  it("slides along the face when the target is diagonal", () => {
    const end = sweepMove({ x: -3 * S, y: lowY, z: -0.2 * S }, { x: 0, y: lowY, z: 3 * S }, half, [wall], lowY);
    expect(end.z).toBeGreaterThan(0.5 * S); // went around, not through
  });

  it("rises along the side of a tower and only then goes on top", () => {
    const aim = { x: 0, y: RUG_H + S + 0.5 * S + HOVER_GAP, z: 0 }; // straight above the block
    const end = sweepMove({ x: -1.5 * S, y: lowY, z: 0 }, aim, half, [wall], lowY);
    expect(end.y).toBeGreaterThan(lowY); // it climbed
    expect(Math.abs(end.x)).toBeGreaterThanOrEqual(S - 0.01); // but is still beside the block, not inside it
  });

  it("is not held by a block it already overlaps, nor by a block resting on top of it", () => {
    const inside = sweepMove({ x: 0.2, y: RUG_H + 0.5 * S, z: 0 }, { x: 3 * S, y: RUG_H + 0.5 * S, z: 0 }, half, [wall], lowY);
    expect(inside.x).toBeCloseTo(3 * S, 6);
    const above = cubeAt(2, 3 * S, RUG_H + 1.5 * S, 0);
    const free = sweepMove({ x: 3 * S, y: lowY, z: 0 }, { x: 4 * S, y: lowY, z: 0 }, half, [above], lowY);
    expect(free.x).toBeCloseTo(4 * S, 6);
  });
});

describe("stable fits on a tower", () => {
  const base = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
  const onTop = RUG_H + S + 0.5 * S + HOVER_GAP;

  it("never magnet-locks a cube onto the edge of another (its centre would be over the edge and it would tip off)", () => {
    for (let x = 0; x <= 0.9 * S; x += 0.02) {
      const r = computeCarry({ kind: "cube", x, z: 0, yaw: 0, heldY: onTop, stickyId: 1, others: [base] });
      if (r.supportId === 1) expect(Math.abs(r.rest?.x ?? r.x)).toBeLessThanOrEqual(0.5 * S - SAFE_EDGE * S + 1e-6);
    }
  });

  it("keeps a long brick on a cube centred, never hanging by its end", () => {
    const r = computeCarry({ kind: "brick", x: 0.4 * S, z: 0, yaw: 0, heldY: onTop, stickyId: 1, others: [base] });
    expect(Math.abs(r.rest?.x ?? r.x)).toBeLessThanOrEqual(0.5 * S - SAFE_EDGE * S + 1e-6);
  });

  it("allows the half-brick offset where the centre is still well over the support", () => {
    const brick = { id: 3, kind: "brick" as const, x: 0, y: RUG_H + 0.5 * S, z: 0, q: id };
    const r = computeCarry({ kind: "cube", x: 0.5 * S, z: 0, yaw: 0, heldY: onTop, stickyId: 3, others: [brick] });
    expect(r.x).toBeCloseTo(0.5 * S, 6);
  });

  it("on release it goes to the stable spot, but while carrying it follows the finger continuously (no hop at the edge)", () => {
    const fingerFar = computeCarry({ kind: "cube", x: 0.8 * S, z: 0, yaw: 0, heldY: onTop, stickyId: 1, others: [base] });
    expect(fingerFar.rest!.x).toBeLessThanOrEqual(0.5 * S - SAFE_EDGE * S + 1e-6); // stays up when put down
    expect(fingerFar.x).toBeGreaterThan(fingerFar.rest!.x); // but the carried block is not yanked back
    let prev: number | null = null, worst = 0;
    for (let x = 0; x <= 2.2 * S; x += 0.01) {
      const r = computeCarry({ kind: "cube", x, z: 0, yaw: 0, heldY: onTop, stickyId: 1, others: [base] });
      if (prev !== null) worst = Math.max(worst, Math.abs(r.x - prev));
      prev = r.x;
    }
    expect(worst).toBeLessThan(0.08); // also across the point where the block loses its support
  });

  it("a carried stack floats hardly at all above the rug", () => {
    const r = computeCarry({ kind: "cube", x: 4 * S, z: 0, yaw: 0, heldY: 2, stickyId: null, others: [], lift: 0.05 });
    expect(r.y).toBeCloseTo(RUG_H + 0.5 * S + 0.05);
  });
});

describe("spawning in view", () => {
  it("appears around the anchor, only where accepted, and inside the rim", () => {
    const accept = (x: number, z: number) => Math.abs(x - 3) < 2.5 && Math.abs(z + 2) < 2.5;
    for (let i = 0; i < 20; i++) {
      const [x, y, z] = pickSpawn("cube", [], Math.random, { anchor: { x: 3, z: -2 }, accept });
      expect(accept(x, z)).toBe(true);
      expect(Math.hypot(x, z)).toBeLessThan(PLAY_AREA - 1);
      expect(y).toBeGreaterThan(RUG_H + S);
    }
  });

  it("falls back to the anchor when nothing is acceptable, never outside the rim", () => {
    const [x, , z] = pickSpawn("cube", [], Math.random, { anchor: { x: 40, z: 0 }, accept: () => false });
    expect(Math.hypot(x, z)).toBeLessThan(PLAY_AREA);
  });
});
