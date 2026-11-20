import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { GROUP_GROUND, PLAY_AREA, RUG_H } from "@/game/shapes";

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
  const rug = useMemo(rugTexture, []);
  const W = PLAY_AREA;
  return (
    <>
      {/* The rug IS the play space: same radius as the walls, and a slab of thickness RUG_H whose top face is the physics ground. */}
      <mesh position-y={RUG_H / 2} receiveShadow userData={{ surface: true }}>
        <cylinderGeometry args={[W, W, RUG_H, 96]} />
        <meshStandardMaterial attach="material-0" color="#141830" roughness={0.95} />
        <meshStandardMaterial attach="material-1" map={rug} roughness={0.95} />
        <meshStandardMaterial attach="material-2" color="#141830" roughness={0.95} />
      </mesh>
      {/* Low rim so the edge of the space reads clearly */}
      <mesh position-y={RUG_H + 0.14}>
        <cylinderGeometry args={[W + 0.16, W + 0.16, 0.28, 96, 1, true]} />
        <meshStandardMaterial color="#323a6a" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <RigidBody type="fixed" colliders={false} friction={1} restitution={0} collisionGroups={GROUP_GROUND}>
        <CuboidCollider args={[30, 0.5, 30]} position={[0, RUG_H - 0.5, 0]} />
        {/* Circular boundary from short tangential wall segments: the inner face is exactly the rug edge. */}
        {Array.from({ length: 64 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          const r = W + 0.16;
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
