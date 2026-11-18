import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, ContactShadows } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { Trash2, Sparkles, Smartphone, SmartphoneNfc } from "lucide-react";
import {
  SHAPES, TOY_COLORS, shapeDef, type BlockData, type ShapeKind,
  SPAWN_HEIGHT, DRAG_FOLLOW, THROW_MAX, SHAKE_THRESHOLD, SHAKE_IMPULSE,
} from "@/game/shapes";
import { bodies } from "@/game/registry";
import { sfx, unlockAudio } from "@/game/audio";
import { Block } from "./Block";
import { Room } from "./Room";
import { ShapeIcon } from "./ShapeIcon";

interface DragState {
  id: number;
  pointerId: number;
  x: number;
  y: number;
  vel: THREE.Vector3;
  history: { t: number; p: THREE.Vector3 }[];
  startY: number;
  startPointerY: number;
}

const tmpV = new THREE.Vector3();
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const yawQ = new THREE.Quaternion();
const curQ = new THREE.Quaternion();
const eul = new THREE.Euler();

function DragController({
  drag, blocks,
}: { drag: React.MutableRefObject<DragState | null>; blocks: React.MutableRefObject<BlockData[]> }) {
  const { camera, gl } = useThree();
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

  useFrame((_, delta) => {
    const d = drag.current;
    const dt = Math.min(delta, 0.05);
    const heldBody = d ? bodies.get(d.id) : null;

    if (!d || !heldBody) return;
    const data = blocks.current.find((b) => b.id === d.id);
    if (!data) return;
    const def = shapeDef(data.kind);
    const rect = gl.domElement.getBoundingClientRect();
    ndc.set(((d.x - rect.left) / rect.width) * 2 - 1, -((d.y - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);

    // Vertical finger travel lifts the toy; horizontal movement is projected
    // onto a horizontal plane at that height instead of being clamped to floor level.
    const lift = (d.startPointerY - d.y) * 0.018;
    let targetY = Math.max(def.halfHeight + 0.06, d.startY + lift);
    plane.current.constant = -targetY;
    const target = ray.ray.intersectPlane(plane.current, tmpV);
    if (!target) return;

    // Friendly tower assist: when the dragged block is brought over another
    // block, gently align its base with that block's top surface.
    let bestTop: number | null = null;
    let bestDistance = Infinity;
    bodies.forEach((candidate, candidateId) => {
      if (candidateId === d.id) return;
      const pos = candidate.translation();
      const candidateData = blocks.current.find((b) => b.id === candidateId);
      if (!candidateData) return;
      const candidateDef = shapeDef(candidateData.kind);
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const reach = Math.max(0.8, def.halfWidth * 0.72 + candidateDef.halfWidth * 0.72);
      const distance = Math.hypot(dx, dz);
      const candidateTop = pos.y + candidateDef.halfHeight * 1.18;
      if (distance < reach && (candidateTop > (bestTop ?? -Infinity) || (candidateTop === bestTop && distance < bestDistance))) {
        bestDistance = distance;
        bestTop = candidateTop;
      }
    });
    // The lift is automatic: horizontal movement over a tower raises the
    // carried piece to the highest reachable top surface.
    if (bestTop !== null) {
      targetY = bestTop + def.halfHeight * 1.18;
    }
    target.y = targetY;

    const cur = heldBody.translation();
    const k = 1 - Math.exp(-DRAG_FOLLOW * dt);
    const next = new THREE.Vector3(
      cur.x + (target.x - cur.x) * k,
      cur.y + (target.y - cur.y) * k,
      cur.z + (target.z - cur.z) * k,
    );
    heldBody.setNextKinematicTranslation(next);

    // Keep yaw but remove accidental tilt while positioning pieces.
    const r = heldBody.rotation();
    curQ.set(r.x, r.y, r.z, r.w);
    eul.setFromQuaternion(curQ, "YXZ");
    yawQ.setFromEuler(eul.set(0, eul.y, 0, "YXZ"));
    curQ.slerp(yawQ, k);
    heldBody.setNextKinematicRotation(curQ);

    const now = performance.now();
    d.history.push({ t: now, p: next.clone() });
    while (d.history.length > 2 && now - d.history[0]!.t > 120) d.history.shift();
  });
  return null;
}

export default function Playroom() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const blocksRef = useRef<BlockData[]>([]);
  blocksRef.current = blocks;
  const [colorIdx, setColorIdx] = useState(0);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [trashHot, setTrashHot] = useState(false);
  const [notice, setNotice] = useState("");
  const [shakeOn, setShakeOn] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef<DragState | null>(null);
  const controls = useRef<any>(null);
  const trashEl = useRef<HTMLButtonElement>(null);
  const nextId = useRef(1);
  const touches = useRef(new Set<number>());

  const overTrash = (x: number, y: number) => {
    const r = trashEl.current?.getBoundingClientRect();
    if (!r) return false;
    const pad = 16;
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  };

  const spawn = (kind: ShapeKind) => {
    setNotice("");
    unlockAudio();
    const color = TOY_COLORS[colorIdx % TOY_COLORS.length]!;
    setColorIdx((i) => i + 1);
    const id = nextId.current++;
    setBlocks((b) => [...b, { id, kind, color, spawn: [(Math.random() - 0.5) * 2, SPAWN_HEIGHT, (Math.random() - 0.5) * 2] }]);
    sfx.spawn();
  };

  const release = useCallback((x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setActiveId(null);
    setTrashHot(false);
    const body = bodies.get(d.id);
    if (overTrash(x, y)) {
      setBlocks((b) => b.filter((bl) => bl.id !== d.id));
      setNotice("A kocka a kukába került!");
      sfx.trash();
      return;
    }
    if (body) {
      body.setBodyType(0, true); // dynamic
      const h = d.history;
      let v = new THREE.Vector3();
      if (h.length >= 2) {
        const a = h[0]!, b = h[h.length - 1]!;
        const dt = Math.max(0.016, (b.t - a.t) / 1000);
        v = b.p.clone().sub(a.p).divideScalar(dt);
        // throwing: flicks fly with a little arc
        const speed = v.length();
        if (speed > 3.5) v.y += Math.min(1.2, speed * 0.12);
        if (v.length() > THROW_MAX) v.setLength(THROW_MAX);
      }
      body.setLinvel(v, true);
      body.setAngvel({ x: v.z * 0.3, y: 0, z: -v.x * 0.3 }, true);
    }
    sfx.drop();
  }, []);

  const onGrab = useCallback((id: number, e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (touches.current.size > 1) return;
    e.stopPropagation();
    if (drag.current) return;
    const body = bodies.get(id);
    if (!body) return;
    setNotice("");
    unlockAudio();
    body.setBodyType(2, true); // kinematic position
    drag.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, vel: new THREE.Vector3(), history: [], startY: body.translation().y, startPointerY: e.clientY };
    setActiveId(id);
    sfx.pick();
  }, []);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") touches.current.add(e.pointerId);
      // second finger: cancel drag so the view can rotate
      if (touches.current.size > 1 && drag.current) {
        const active = drag.current;
        const body = bodies.get(active.id);
        drag.current = null;
        if (body) {
          body.setBodyType(0, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        setActiveId(null);
        setTrashHot(false);
      }
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      const hot = overTrash(e.clientX, e.clientY);
      setTrashHot((h) => (h === hot ? h : hot));
    };
    const up = (e: PointerEvent) => {
      touches.current.delete(e.pointerId);
      const d = drag.current;
      if (d && e.pointerId === d.pointerId) release(e.clientX, e.clientY);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [release]);

  // Shaking the phone
  const shake = useCallback((ax: number, ay: number, az: number) => {
    bodies.forEach((b, id) => {
      if (drag.current?.id === id) return;
      const m = b.mass();
      b.applyImpulse({ x: ax * m * SHAKE_IMPULSE, y: Math.abs(ay) * m * SHAKE_IMPULSE + m * 0.4, z: az * m * SHAKE_IMPULSE }, true);
      b.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.3, y: (Math.random() - 0.5) * m * 0.3, z: (Math.random() - 0.5) * m * 0.3 }, true);
    });
  }, []);

  useEffect(() => {
    if (!shakeOn) return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      if (!a || a.x == null) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const now = performance.now();
      if (mag < SHAKE_THRESHOLD || now - last < 90) return;
      last = now;
      shake((a.x ?? 0) * 0.6, (a.y ?? 0) * 0.6, -(a.z ?? 0) * 0.6);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") shake((Math.random() - 0.5) * 30, 15, (Math.random() - 0.5) * 30);
    };
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("keydown", onKey);
    };
  }, [shakeOn, shake]);

  const toggleShake = async () => {
    unlockAudio();
    sfx.click();
    if (!shakeOn) {
      const DM = (window as any).DeviceMotionEvent;
      if (DM && typeof DM.requestPermission === "function") {
        try {
          const res = await DM.requestPermission();
          if (res !== "granted") return;
        } catch {
          return;
        }
      }
    }
    setShakeOn((s) => !s);
  };

  const clearAll = () => {
    if (!blocks.length) return;
    drag.current = null;
    setActiveId(null);
    setBlocks([]);
    setNotice("Minden kocka eltűnt!");
    sfx.clear();
  };

  const nextColor = TOY_COLORS[colorIdx % TOY_COLORS.length]!;

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-background touch-none" data-scene-ready={ready ? "" : undefined}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [9, 9, 14], fov: 45 }}
        onCreated={() => setTimeout(() => setReady(true), 300)}
        style={{ position: "absolute", inset: 0 }}
      >
        <color attach="background" args={["#bfe6ff"]} />
        <fog attach="fog" args={["#bfe6ff", 25, 55]} />
        <hemisphereLight args={["#fff6e5", "#c98b4f", 0.6]} />
        <directionalLight
          position={[6, 12, 5]}
          intensity={1.8}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-12}
          shadow-camera-right={12}
          shadow-camera-top={12}
          shadow-camera-bottom={-12}
          shadow-bias={-0.0004}
        />
        <Environment resolution={128}>
          <Lightformer intensity={2} position={[0, 6, 0]} scale={[10, 10, 1]} rotation-x={Math.PI / 2} />
          <Lightformer intensity={1.2} color="#ffd9a0" position={[-6, 2, -2]} rotation-y={Math.PI / 2} scale={[20, 2, 1]} />
          <Lightformer intensity={1} color="#a8d8ff" position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[20, 2, 1]} />
        </Environment>
        <Suspense fallback={null}>
          <Physics gravity={[0, -9.81, 0]}>
            <Room />
            {blocks.map((b) => (
              <Block key={b.id} data={b} onGrab={onGrab} active={activeId === b.id} />
            ))}
          </Physics>
        </Suspense>
        <ContactShadows position={[0, 0.02, 0]} opacity={0.35} scale={16} blur={2.5} far={4} />
        <DragController drag={drag} blocks={blocksRef} />
        <OrbitControls
          ref={controls}
          target={[0, 1.5, 0]}
          enablePan={false}
          enableRotate
          enableZoom
          rotateSpeed={0.75}
          zoomSpeed={0.8}
          minDistance={5}
          maxDistance={48}
          maxPolarAngle={Math.PI / 2.15}
          mouseButtons={{ LEFT: undefined as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
          touches={{ ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        />
      </Canvas>

      {/* Top bar: below the status bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}>
        <div className="pointer-events-auto rounded-full bg-card/85 px-4 py-2 font-display text-lg font-bold text-card-foreground shadow-toy backdrop-blur">
          Kockavár
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            onClick={toggleShake}
            aria-pressed={shakeOn}
            aria-label="Rázás be/ki"
            className={`flex h-11 items-center gap-1.5 rounded-full px-4 font-display text-sm font-bold shadow-toy backdrop-blur transition-transform active:scale-95 ${shakeOn ? "bg-primary text-primary-foreground" : "bg-card/85 text-card-foreground"}`}
          >
            {shakeOn ? <SmartphoneNfc className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
            Rázás {shakeOn ? "be" : "ki"}
          </button>
          <button
            onClick={clearAll}
            aria-label="Minden törlése"
            className="flex min-h-14 items-center gap-2 rounded-full bg-card/85 px-4 font-display text-base font-bold text-card-foreground shadow-toy backdrop-blur transition-transform active:scale-95"
          >
            <Sparkles className="h-5 w-5" /> Mind el
          </button>
        </div>
      </div>

      {/* Trash */}
      <button
        ref={trashEl}
        aria-label="Kuka: ide húzd a törlendő elemet"
        className={`absolute right-3 flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-3xl border-2 shadow-toy transition-all ${
          trashHot ? "scale-110 border-destructive bg-destructive text-destructive-foreground" : activeId ? "scale-105 border-destructive/50 bg-card text-destructive" : "border-border bg-card/90 text-muted-foreground"
        }`}
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 126px)" }}
      >
        <Trash2 className="h-11 w-11" />
        <span className="font-display text-sm font-extrabold">KUKA</span>
      </button>

      {notice && (
        <div role="status" className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 rounded-full bg-card/95 px-5 py-3 text-center font-display text-base font-bold text-card-foreground shadow-toy backdrop-blur">
          {notice}
        </div>
      )}

      {/* Hint */}
      {blocks.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-display text-xl font-bold text-foreground/80 drop-shadow">
          Koppints egy elemre lent!
          <div className="mt-1 text-sm font-semibold text-foreground/60">
            Egy ujj: emelés, építés és dobás · Két ujj: forgatás, nagyítás
          </div>
        </div>
      )}

      {/* Shape tray */}
      <div className="absolute inset-x-0 bottom-0 px-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 10px)" }}>
        <div className="mx-auto flex max-w-xl gap-1.5 overflow-x-auto rounded-3xl bg-card/85 p-2 shadow-toy backdrop-blur">
          {SHAPES.map((s) => (
            <button
              key={s.kind}
              onClick={() => spawn(s.kind)}
              aria-label={s.label}
              className="flex min-w-[78px] min-h-[88px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-transform hover:bg-muted active:scale-95"
            >
              <ShapeIcon kind={s.kind} color={nextColor} />
              <span className="font-display text-xs font-extrabold text-card-foreground">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
