import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { GROUP_GROUND, PLAY_AREA, RUG_H } from "@/game/shapes";

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  // wooden planks
  const planks = ["#2d2430", "#2a2230", "#322835", "#261f2c"];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = planks[i % 4]!;
    g.fillRect(0, i * 128, 1024, 128);
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(0, i * 128, 1024, 3);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
      g.fillRect(Math.random() * 1024, i * 128 + Math.random() * 128, 80 + Math.random() * 200, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rugTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  const rings = ["#232a4a", "#1b2140", "#2a3157", "#1b2140", "#232a4a", "#1b2140", "#2a3157", "#171c36"];
  for (let i = 0; i < rings.length; i++) {
    g.beginPath();
    g.arc(512, 512, 512 - i * 62, 0, Math.PI * 2);
    g.fillStyle = rings[i]!;
    g.fill();
  }
  // little stars
  g.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(512 + Math.cos(a) * 470, 512 + Math.sin(a) * 470, 10, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function Room() {
  const floor = useMemo(floorTexture, []);
  const rug = useMemo(rugTexture, []);
  const W = PLAY_AREA;
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow userData={{ surface: true }}>
        <circleGeometry args={[W + 1.25, 96]} />
        <meshStandardMaterial map={floor} roughness={0.7} />
      </mesh>
      {/* The rug is a real slab of thickness RUG_H; the physics ground is exactly its top face. */}
      <mesh position-y={RUG_H / 2} receiveShadow userData={{ surface: true }}>
        <cylinderGeometry args={[W, W, RUG_H, 96]} />
        <meshStandardMaterial attach="material-0" color="#141830" roughness={0.95} />
        <meshStandardMaterial attach="material-1" map={rug} roughness={0.95} />
        <meshStandardMaterial attach="material-2" color="#141830" roughness={0.95} />
      </mesh>
      <RigidBody type="fixed" colliders={false} friction={1} restitution={0} collisionGroups={GROUP_GROUND}>
        <CuboidCollider args={[30, 0.5, 30]} position={[0, RUG_H - 0.5, 0]} />
        {/* A smooth-enough circular boundary made from short tangential wall segments (inner face inside the rug edge). */}
        {Array.from({ length: 64 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          const r = W + 0.12;
          return (
            <CuboidCollider
              key={i}
              args={[0.34, 8, 0.16]}
              position={[Math.cos(a) * r, 8, Math.sin(a) * r]}
              rotation={[0, -a + Math.PI / 2, 0]}
              friction={0.1}
            />
          );
        })}
      </RigidBody>
    </>
  );
}
