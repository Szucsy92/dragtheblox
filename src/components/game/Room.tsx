import { useMemo } from "react";
import * as THREE from "three";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { PLAY_AREA } from "@/game/shapes";

function floorTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  // wooden planks
  const planks = ["#d9a066", "#cf9358", "#e2ad74", "#c98b4f"];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = planks[i % 4]!;
    g.fillRect(0, i * 128, 1024, 128);
    g.fillStyle = "rgba(90,50,20,0.35)";
    g.fillRect(0, i * 128, 1024, 3);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(120,70,30,${Math.random() * 0.08})`;
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
  const rings = ["#1d7fd8", "#ffd60a", "#e63946", "#2a9d4b", "#f4a020", "#ff6fa8", "#17bebb", "#fff4e0"];
  for (let i = 0; i < rings.length; i++) {
    g.beginPath();
    g.arc(512, 512, 512 - i * 62, 0, Math.PI * 2);
    g.fillStyle = rings[i]!;
    g.fill();
  }
  // little stars
  g.fillStyle = "#ffffff";
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
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={floor} roughness={0.7} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01} receiveShadow userData={{ surface: true }}>
        <circleGeometry args={[W, 64]} />
        <meshStandardMaterial map={rug} roughness={0.95} />
      </mesh>
      <RigidBody type="fixed" colliders={false} friction={1}>
        <CuboidCollider args={[30, 0.5, 30]} position={[0, -0.5, 0]} />
        {/* invisible walls keep toys in the room when shaking */}
        <CuboidCollider args={[W + 3, 20, 0.5]} position={[0, 20, -(W + 3)]} />
        <CuboidCollider args={[W + 3, 20, 0.5]} position={[0, 20, W + 3]} />
        <CuboidCollider args={[0.5, 20, W + 3]} position={[-(W + 3), 20, 0]} />
        <CuboidCollider args={[0.5, 20, W + 3]} position={[W + 3, 20, 0]} />
      </RigidBody>
    </>
  );
}
