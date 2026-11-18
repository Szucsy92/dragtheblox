import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import { RigidBody, CuboidCollider, BallCollider, type RapierRigidBody } from "@react-three/rapier";
import type { ThreeEvent } from "@react-three/fiber";
import type { BlockData } from "@/game/shapes";
import { bodies } from "@/game/registry";
import { knock } from "@/game/audio";

function archGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1, -0.6);
  s.lineTo(-0.5, -0.6);
  s.lineTo(-0.5, -0.1);
  s.absarc(0, -0.1, 0.5, Math.PI, 0, true);
  s.lineTo(0.5, -0.6);
  s.lineTo(1, -0.6);
  s.lineTo(1, 0.6);
  s.lineTo(-1, 0.6);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -0.5);
  return g;
}
function roofGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1, -0.4);
  s.lineTo(1, -0.4);
  s.lineTo(0, 0.4);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  g.translate(0, 0, -0.5);
  return g;
}
function halfGeometry() {
  const g = new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(0, -0.3, 0);
  // add a flat base
  const base = new THREE.CircleGeometry(0.6, 32);
  base.rotateX(Math.PI / 2);
  base.translate(0, -0.3, 0);
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
  const { kind, color, id } = data;
  const rot = useMemo<[number, number, number]>(() => [0, Math.random() * 0.6 - 0.3, 0], []);
  const geo = useMemo(() => {
    if (kind === "arch") return archGeometry();
    if (kind === "roof") return roofGeometry();
    if (kind === "half") return halfGeometry();
    return null;
  }, [kind]);

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
  let colliders: "hull" | "ball" | false = false;
  let manual: React.ReactNode = null;
  switch (kind) {
    case "cube":
      mesh = <RoundedBox args={[1, 1, 1]} radius={0.07} smoothness={3} {...common}>{mat}</RoundedBox>;
      manual = <CuboidCollider args={[0.5, 0.5, 0.5]} />;
      break;
    case "brick":
      mesh = <RoundedBox args={[2, 1, 1]} radius={0.07} smoothness={3} {...common}>{mat}</RoundedBox>;
      manual = <CuboidCollider args={[1, 0.5, 0.5]} />;
      break;
    case "cylinder":
      mesh = <mesh {...common}><cylinderGeometry args={[0.5, 0.5, 1, 32]} />{mat}</mesh>;
      colliders = "hull";
      break;
    case "cone":
      mesh = <mesh {...common}><coneGeometry args={[0.5, 1, 32]} />{mat}</mesh>;
      colliders = "hull";
      break;
    case "sphere":
      mesh = <mesh {...common}><sphereGeometry args={[0.5, 32, 24]} />{mat}</mesh>;
      manual = <BallCollider args={[0.5]} />;
      break;
    case "arch":
      mesh = <mesh geometry={geo!} {...common}>{mat}</mesh>;
      manual = (
        <>
          <CuboidCollider args={[0.25, 0.35, 0.5]} position={[-0.75, -0.25, 0]} />
          <CuboidCollider args={[0.25, 0.35, 0.5]} position={[0.75, -0.25, 0]} />
          <CuboidCollider args={[1, 0.25, 0.5]} position={[0, 0.35, 0]} />
        </>
      );
      break;
    default:
      mesh = <mesh geometry={geo!} {...common}>{mat}</mesh>;
      colliders = "hull";
  }

  return (
    <RigidBody
      ref={(b) => {
        (ref as any).current = b;
        if (b) bodies.set(id, b);
        else bodies.delete(id);
      }}
      position={data.spawn}
      rotation={rot}
      colliders={colliders}
      friction={0.75}
      restitution={0.08}
      linearDamping={0.18}
      angularDamping={0.55}
      ccd
      onContactForce={(p) => {
        const f = p.maxForceMagnitude;
        if (f > 65) knock(Math.log10(f) / 5 - 0.42);
      }}
    >
      <group scale={1.18}>
        {mesh}
        {manual}
      </group>
    </RigidBody>
  );
});
