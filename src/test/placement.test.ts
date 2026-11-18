import { describe, expect, it } from "vitest";
import { computeCarry, pickSpawn, quatYaw, HALF_PI, type Other } from "@/game/placement";
import { BLOCK_SCALE as S, DRAG_LIFT, HOVER_GAP, RUG_H } from "@/game/shapes";

const id = { x: 0, y: 0, z: 0, w: 1 };
const yawQ = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const cubeAt = (n: number, x: number, y: number, z: number, q = id): Other => ({ id: n, kind: "cube", x, y, z, q });

describe("computeCarry", () => {
  it("floats a block just above the rug, never inside it", () => {
    const r = computeCarry({ kind: "cube", x: 1, z: 1, yaw: 0, heldY: 1, others: [] });
    expect(r.y).toBeCloseTo(RUG_H + 0.5 * S + DRAG_LIFT);
    expect(r.top).toBe(RUG_H);
  });

  it("hovers above a cube instead of entering it, and magnet-centres", () => {
    const base = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
    const r = computeCarry({ kind: "cube", x: 0.1, z: -0.08, yaw: 0, heldY: 2, others: [base] });
    expect(r.supportId).toBe(1);
    expect(r.y).toBeCloseTo(RUG_H + S + 0.5 * S + HOVER_GAP);
    expect(r.snapped).toBe(true);
    expect(r.x).toBeCloseTo(0);
    expect(r.z).toBeCloseTo(0);
  });

  it("ignores a block resting on top of the carried one", () => {
    const above = cubeAt(2, 0, RUG_H + 1.5 * S, 0);
    const r = computeCarry({ kind: "cube", x: 0, z: 0, yaw: 0, heldY: RUG_H + 0.5 * S, others: [above] });
    expect(r.supportId).toBeNull();
  });

  it("uses the tallest support and aligns yaw to it (mod 90°)", () => {
    const low = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
    const tall = cubeAt(2, 0.2, RUG_H + 1.5 * S, 0, yawQ(0.3));
    const r = computeCarry({ kind: "cube", x: 0.1, z: 0, yaw: 0, heldY: 6, others: [low, tall] });
    expect(r.supportId).toBe(2);
    expect(Math.abs(r.yaw - quatYaw(tall.q)) % HALF_PI).toBeLessThan(1e-6);
  });

  it("does not lift for a barely touching block", () => {
    const base = cubeAt(1, 0, RUG_H + 0.5 * S, 0);
    const r = computeCarry({ kind: "cube", x: 0.95 * S, z: 0, yaw: 0, heldY: 1, others: [base] });
    expect(r.supportId).toBeNull();
  });

  it("hovers above a tipped-over block using its real height, without snapping", () => {
    // brick lying on its end: 2*S tall
    const tilted: Other = { id: 3, kind: "brick", x: 0, y: RUG_H + S, z: 0, q: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } };
    const r = computeCarry({ kind: "cube", x: 0, z: 0, yaw: 0, heldY: 4, others: [tilted] });
    expect(r.snapped).toBe(false);
    expect(r.top).toBeCloseTo(RUG_H + 2 * S);
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
