import type { RapierRigidBody } from "@react-three/rapier";
import type { Other } from "./placement";
import { GROUP_BLOCK, GROUP_HELD, type ShapeKind } from "./shapes";

// Live physics bodies keyed by block id (outside React state).
export const bodies = new Map<number, RapierRigidBody>();
// What kind of block each id is (needed for sizes while carrying).
export const kinds = new Map<number, ShapeKind>();

/** The hand supports the selected body; contact with all other bodies stays enabled. */
export function setCarried(body: RapierRigidBody, carried: boolean) {
  body.setGravityScale(carried ? 0 : 1, true);
  for (let i = 0; i < body.numColliders(); i++) {
    body.collider(i).setCollisionGroups(carried ? GROUP_HELD : GROUP_BLOCK);
  }
}

/** Plain pose snapshot of all live blocks except `excludeId`, for the pure placement maths. */
export function snapshot(excludeId?: number): Other[] {
  const out: Other[] = [];
  bodies.forEach((b, id) => {
    if (id === excludeId) return;
    const kind = kinds.get(id);
    if (!kind) return;
    const t = b.translation();
    const r = b.rotation();
    out.push({ id, kind, x: t.x, y: t.y, z: t.z, q: { x: r.x, y: r.y, z: r.z, w: r.w } });
  });
  return out;
}
