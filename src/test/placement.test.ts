import { describe, expect, it } from "vitest";
import { clampArena, computeCarry, overlapsOther, pickBlock, pickSpawn, quatYaw, HALF_PI, type Other } from "@/game/placement";
import { BLOCK_SCALE as S, DRAG_LIFT, HOVER_GAP, PLAY_AREA, RUG_H } from "@/game/shapes";

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
  // finger ray 5 up and 4 back, looking 45° down at the tower
  const tower = [cubeAt(1, 0, RUG_H + 0.5 * S, 0), cubeAt(2, 0, RUG_H + 1.5 * S, 0)];
  const d = Math.SQRT1_2;
  it("hits the tower from the front and aims at the front edge of its top", () => {
    const p = pickBlock(0, 5, 4, 0, -d, -d, tower, 9);
    expect(p?.id).toBe(2);
    expect(p!.top).toBeCloseTo(RUG_H + 2 * S);
    expect(Math.abs(p!.z)).toBeLessThanOrEqual(0.5 * S + 1e-9);
  });
  it("misses when the ray passes beside the tower", () => {
    expect(pickBlock(5, 5, 4, 0, -d, -d, tower, 9)).toBeNull();
  });
  it("ignores blocks that sit on top of the carried one", () => {
    expect(pickBlock(0, 5, 4, 0, -d, -d, tower, RUG_H + 0.5 * S)?.id).toBe(1);
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
