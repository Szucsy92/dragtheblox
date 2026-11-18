import type { RapierRigidBody } from "@react-three/rapier";
// Live physics bodies keyed by block id (outside React state).
export const bodies = new Map<number, RapierRigidBody>();
