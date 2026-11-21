import type { RapierRigidBody } from "@react-three/rapier";
import type { Other } from "./placement";
import { GROUP_BLOCK, GROUP_HELD, GROUP_PASSENGER, type ShapeKind } from "./shapes";

// Live physics bodies keyed by block id (outside React state).
export const bodies = new Map<number, RapierRigidBody>();
// What kind of block each id is (needed for sizes while carrying).
export const kinds = new Map<number, ShapeKind>();

/** Start / stop carrying: gravity off, and no collisions with other blocks (except its own passengers). */
export function setCarried(body: RapierRigidBody, carried: boolean) {
  body.setGravityScale(carried ? 0 : 1, true);
  for (let i = 0; i < body.numColliders(); i++) {
    body.collider(i).setCollisionGroups(carried ? GROUP_HELD : GROUP_BLOCK);
  }
}

/** A block resting on the carried one rides along through real contact (friction), and still hits everything else. */
export function setPassenger(body: RapierRigidBody, on: boolean) {
  for (let i = 0; i < body.numColliders(); i++) {
    body.collider(i).setCollisionGroups(on ? GROUP_PASSENGER : GROUP_BLOCK);
  }
}

/**
 * Current pose of a block, or null. A body that has been freed by the physics engine (or is otherwise unreadable)
 * is dropped from the registry instead of throwing: an exception in the frame loop would freeze the whole game.
 */
export function poseOf(id: number): { t: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } } | null {
  const b = bodies.get(id);
  if (!b) return null;
  try {
    const t = b.translation();
    const q = b.rotation();
    return { t: { x: t.x, y: t.y, z: t.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  } catch {
    bodies.delete(id);
    kinds.delete(id);
    return null;
  }
}

/** Plain pose snapshot of all live blocks except `excludeId`, for the pure placement maths. */
export function snapshot(excludeId?: number): Other[] {
  const out: Other[] = [];
  for (const id of Array.from(bodies.keys())) {
    if (id === excludeId) continue;
    const kind = kinds.get(id);
    const p = kind ? poseOf(id) : null;
    if (!kind || !p) continue;
    out.push({ id, kind, x: p.t.x, y: p.t.y, z: p.t.z, q: p.q });
  }
  return out;
}
