import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { RigidBody, CuboidCollider, BallCollider, ConvexHullCollider, type RapierRigidBody } from "@react-three/rapier";
import type { ThreeEvent } from "@react-three/fiber";
import { BLOCK_SCALE as S, GROUP_BLOCK, type BlockData } from "@/game/shapes";
import { bodies, kinds } from "@/game/registry";
import { impactStrength } from "@/game/impact";
import { knock } from "@/game/audio";

// All sizes below are in block units and scaled by S ONCE, when the geometry / collider is built.
// There is no scaled parent group, so what you see is exactly what collides.

const ARCH = { hw: 1, hh: 0.6, depth: 1, R: 0.5, cy: -0.1, bevel: 0.03 };

function archGeometry() {
  const { hw, hh, depth, R, cy, bevel: b } = ARCH;
  // three.js grows the outline by `bevel` on the sides, so the outline is inset by it:
  // the finished block is exactly hw x hh x depth and the opening is exactly radius R.
  const Rs = R + b;
  const s = new THREE.Shape();
  s.moveTo(-(hw - b), -(hh - b));
  s.lineTo(-Rs, -(hh - b));
  s.lineTo(-Rs, cy);
  s.absarc(0, cy, Rs, Math.PI, 0, true);
  s.lineTo(Rs, -(hh - b));
  s.lineTo(hw - b, -(hh - b));
  s.lineTo(hw - b, hh - b);
  s.lineTo(-(hw - b), hh - b);
  s.closePath();
  const d = depth - 2 * b;
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 32 });
  g.translate(0, 0, -d / 2);
  g.scale(S, S, S);
  return g;
}

/** Arch colliders: two legs + the dome above the opening cut into convex slices that follow the curve. */
function archColliderParts() {
  const { hw, hh, depth, R, cy } = ARCH;
  const hz = depth / 2;
  const legW = hw - R;
  const slices: Float32Array[] = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI, a1 = ((i + 1) / N) * Math.PI;
    const x0 = R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const pts: number[] = [];
    for (const z of [-hz, hz]) {
      pts.push(x0 * S, y0 * S, z * S, x1 * S, y1 * S, z * S, x1 * S, hh * S, z * S, x0 * S, hh * S, z * S);
    }
    slices.push(new Float32Array(pts));
  }
  return { legs: [-(R + legW / 2) * S, (R + legW / 2) * S], legHalf: [(legW / 2) * S, hh * S, hz * S] as [number, number, number], slices };
}

function roofGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1, -0.4);
  s.lineTo(1, -0.4);
  s.lineTo(0, 0.4);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  // The bevel grows the shape a little; fit it back to exactly 2 x 0.8 x 1 so the base sits exactly on the ground.
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.scale((2 / size.x) * S, (0.8 / size.y) * S, (1 / size.z) * S);
  return g;
}

function halfGeometry() {
  const g = new THREE.SphereGeometry(0.6 * S, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(0, -0.3 * S, 0);
  // add a flat base
  const base = new THREE.CircleGeometry(0.6 * S, 32);
  base.rotateX(Math.PI / 2);
  base.translate(0, -0.3 * S, 0);
  const merged = new THREE.BufferGeometry();
  const a = g.toNonIndexed();
  const b = base.toNonIndexed();
  const pos = new Float32Array([...a.attributes['position']!.array, ...b.attributes['position']!.array]);
  const nor = new Float32Array([...a.attributes['normal']!.array, ...b.attributes['normal']!.array]);
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return merged;
}

interface Props {
  data: BlockData;
  onGrab: (id: number, e: ThreeEvent<PointerEvent>) => void;
  active: boolean;
}

export const Block = memo(function Block({ data, onGrab, active }: Props) {
  const ref = useRef<RapierRigidBody>(null);
  const lastForce = useRef({ a: 0, t: 0 });
  const { kind, color, id } = data;
  const geo = useMemo(() => {
    if (kind === "arch") return archGeometry();
    if (kind === "roof") return roofGeometry();
    if (kind === "half") return halfGeometry();
    return null;
  }, [kind]);
  const arch = useMemo(() => (kind === "arch" ? archColliderParts() : null), [kind]);

  const mat = (
    <meshStandardMaterial
      color={color}
      roughness={0.32}
      metalness={0.02}
      emissive={color}
      emissiveIntensity={active ? 0.35 : 0}
    />
  );
  const common = {
    castShadow: true,
    receiveShadow: true,
    userData: { blockId: id },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => onGrab(id, e),
  };

  let mesh: React.ReactNode;
  let colliders: "hull" | false = false;
  let manual: React.ReactNode = null;
  switch (kind) {
    case "cube":
      mesh = <RoundedBox args={[S, S, S]} radius={0.07 * S} smoothness={3} {...common}>{mat}</RoundedBox>;
      manual = <CuboidCollider args={[0.5 * S, 0.5 * S, 0.5 * S]} />;
      break;
    case "brick":
      mesh = <RoundedBox args={[2 * S, S, S]} radius={0.07 * S} smoothness={3} {...common}>{mat}</RoundedBox>;
      manual = <CuboidCollider args={[S, 0.5 * S, 0.5 * S]} />;
      break;
    case "cylinder":
      mesh = <mesh {...common}><cylinderGeometry args={[0.5 * S, 0.5 * S, S, 32]} />{mat}</mesh>;
      colliders = "hull";
      break;
    case "cone":
      mesh = <mesh {...common}><coneGeometry args={[0.5 * S, S, 32]} />{mat}</mesh>;
      colliders = "hull";
      break;
    case "sphere":
      mesh = <mesh {...common}><sphereGeometry args={[0.5 * S, 32, 24]} />{mat}</mesh>;
      manual = <BallCollider args={[0.5 * S]} />;
      break;
    case "arch":
      mesh = <mesh geometry={geo!} {...common}>{mat}</mesh>;
      manual = (
        <>
          <CuboidCollider args={arch!.legHalf} position={[arch!.legs[0]!, 0, 0]} />
          <CuboidCollider args={arch!.legHalf} position={[arch!.legs[1]!, 0, 0]} />
          {arch!.slices.map((v, i) => <ConvexHullCollider key={i} args={[v]} />)}
        </>
      );
      break;
    default: // roof, half: hull of the exact visual geometry
      mesh = <mesh geometry={geo!} {...common}>{mat}</mesh>;
      colliders = "hull";
  }

  return (
    <RigidBody
      ref={(b) => {
        (ref as any).current = b;
        if (b) { bodies.set(id, b); kinds.set(id, kind); }
        else { bodies.delete(id); kinds.delete(id); }
      }}
      position={data.spawn}
      ccd
      colliders={colliders}
      friction={1}
      restitution={0}
      collisionGroups={GROUP_BLOCK}
      linearDamping={0.1}
      angularDamping={0.8}
      onContactForce={(p) => {
        // Force per mass, and only a sudden jump counts: heavy blocks / tall stacks resting steadily stay quiet.
        const m = ref.current?.mass() ?? 1;
        const a = p.maxForceMagnitude / Math.max(m, 0.01);
        const now = performance.now();
        const prev = now - lastForce.current.t < 120 ? lastForce.current.a : 0;
        lastForce.current = { a, t: now };
        const strength = impactStrength(a, prev);
        if (strength > 0) knock(strength);
      }}
    >
      {mesh}
      {manual}
    </RigidBody>
  );
});
