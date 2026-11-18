import type { RapierRigidBody } from "@react-three/rapier";
import type { Other } from "./placement";
import type { ShapeKind } from "./shapes";

// Live physics bodies keyed by block id (outside React state).
export const bodies = new Map<number, RapierRigidBody>();
// What kind of block each id is (needed for sizes while carrying).
export const kinds = new Map<number, ShapeKind>();

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
