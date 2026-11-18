import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, ContactShadows } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { Trash2, Sparkles, Smartphone, SmartphoneNfc, RotateCw } from "lucide-react";
import {
  SHAPES, TOY_COLORS, shapeDef, halfExtents, type BlockData, type ShapeKind,
  GRAVITY, CARRY_GAIN, CARRY_MAX, ROT_GAIN, ROT_MAX, THROW_MIN, THROW_MAX,
  SHAKE_THRESHOLD, SHAKE_IMPULSE, RUG_H,
} from "@/game/shapes";
import { computeCarry, pickSpawn, HALF_PI } from "@/game/placement";
import { bodies, kinds, snapshot } from "@/game/registry";
import { sfx, unlockAudio } from "@/game/audio";
import { Block } from "./Block";
import { Room } from "./Room";
import { ShapeIcon } from "./ShapeIcon";

interface DragState {
  id: number;
  pointerId: number;
  x: number;
  y: number;
  /** Finger-to-block offset on the ground plane, measured on the first frame so the block never jumps. */
  offX: number;
  offZ: number;
  started: boolean;
  /** Preferred yaw; the player turns it with the rotate button. */
  yaw: number;
}

const tmpV = new THREE.Vector3();
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const UP = new THREE.Vector3(0, 1, 0);
const curQ = new THREE.Quaternion();
const tgtQ = new THREE.Quaternion();
const errQ = new THREE.Quaternion();
const eul = new THREE.Euler();

const MARK_FREE = new THREE.Color("#ffffff");
const MARK_SNAP = new THREE.Color("#7dffb0");

/**
 * Carries the held block. The block stays a normal dynamic body (gravity off) and is steered with
 * velocities, so it can never sink into the rug or other blocks and nothing "pops" when it is let go.
 * Also draws the landing marker: a flat footprint on whatever surface the block would land on.
 */
function DragController({ drag }: { drag: React.MutableRefObject<DragState | null> }) {
  const { camera, gl } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const rectRef = useRef<THREE.Mesh>(null);
  const roundRef = useRef<THREE.Mesh>(null);
  const markMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }),
    [],
  );

  useFrame(() => {
    const rect = rectRef.current, round = roundRef.current;
    const hide = () => { if (rect) rect.visible = false; if (round) round.visible = false; };
    const d = drag.current;
    const body = d ? bodies.get(d.id) : null;
    const kind = d ? kinds.get(d.id) : null;
    if (!d || !body || !kind) return hide();

    const t = body.translation();
    const bb = gl.domElement.getBoundingClientRect();
    ndc.set(((d.x - bb.left) / bb.width) * 2 - 1, -((d.y - bb.top) / bb.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // The finger ray is intersected at the block's own height, so the block stays under the finger while it climbs.
    plane.constant = -t.y;
    const hit = ray.ray.intersectPlane(plane, tmpV);
    if (!hit) return hide();

    if (!d.started) {
      d.started = true;
      const [hx, , hz] = halfExtents(kind);
      let ox = t.x - hit.x, oz = t.z - hit.z;
      const m = Math.hypot(ox, oz), max = Math.max(hx, hz);
      if (m > max) { ox *= max / m; oz *= max / m; }
      d.offX = ox;
      d.offZ = oz;
      const r0 = body.rotation();
      eul.setFromQuaternion(curQ.set(r0.x, r0.y, r0.z, r0.w), "YXZ");
      d.yaw = Math.round(eul.y / HALF_PI) * HALF_PI; // straighten to the 90° grid
    }

    const res = computeCarry({
      kind, x: hit.x + d.offX, z: hit.z + d.offZ, yaw: d.yaw, heldY: t.y, others: snapshot(d.id),
    });

    // Position: steer by velocity (clamped), never teleport.
    let vx = (res.x - t.x) * CARRY_GAIN, vy = (res.y - t.y) * CARRY_GAIN, vz = (res.z - t.z) * CARRY_GAIN;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > CARRY_MAX) { const k = CARRY_MAX / sp; vx *= k; vy *= k; vz *= k; }
    body.setLinvel({ x: vx, y: vy, z: vz }, true);

    // Orientation: turn upright and to the target yaw by angular velocity along the shortest path.
    const r = body.rotation();
    curQ.set(r.x, r.y, r.z, r.w);
    tgtQ.setFromAxisAngle(UP, res.yaw);
    errQ.copy(tgtQ).multiply(curQ.invert());
    if (errQ.w < 0) { errQ.x = -errQ.x; errQ.y = -errQ.y; errQ.z = -errQ.z; errQ.w = -errQ.w; }
    const sinHalf = Math.hypot(errQ.x, errQ.y, errQ.z);
    if (sinHalf < 1e-4) {
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      const angle = 2 * Math.atan2(sinHalf, errQ.w);
      const w = Math.min(ROT_MAX, angle * ROT_GAIN) / sinHalf;
      body.setAngvel({ x: errQ.x * w, y: errQ.y * w, z: errQ.z * w }, true);
    }

    // Landing marker.
    const def = shapeDef(kind);
    const [hx, , hz] = halfExtents(kind);
    const m = def.round ? round : rect;
    if (rect) rect.visible = !def.round;
    if (round) round.visible = def.round;
    if (m) {
      m.position.set(res.x, res.top + 0.012, res.z);
      m.rotation.set(-Math.PI / 2, res.yaw, 0, "YXZ");
      m.scale.set(hx * 2, hz * 2, 1);
    }
    markMat.color.copy(res.snapped ? MARK_SNAP : MARK_FREE);
    markMat.opacity = res.snapped ? 0.65 : 0.4;
  });

  return (
    <>
      <mesh ref={rectRef} visible={false} renderOrder={2} material={markMat}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={roundRef} visible={false} renderOrder={2} material={markMat}>
        <circleGeometry args={[0.5, 48]} />
      </mesh>
    </>
  );
}

export default function Playroom() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
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
    const pos = pickSpawn(kind, snapshot());
    setBlocks((b) => [...b, { id, kind, color, spawn: pos }]);
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
      body.setGravityScale(1, true);
      const lv = body.linvel();
      const speed = Math.hypot(lv.x, lv.z);
      if (speed > THROW_MIN) {
        // Throw: keep the carried velocity, add a little arc, cap it.
        const v = new THREE.Vector3(lv.x, Math.max(0, lv.y), lv.z);
        v.y += Math.min(1.7, speed * 0.12);
        if (v.length() > THROW_MAX) v.setLength(THROW_MAX);
        body.setLinvel(v, true);
        body.setAngvel({ x: v.z * 0.3, y: 0, z: -v.x * 0.3 }, true);
      } else {
        // Gentle place: no leftover sliding or spinning, it just settles.
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    sfx.drop();
  }, []);

  const turnHeld = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    d.yaw += HALF_PI;
    sfx.click();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "e" || e.key === "E" || e.key === " ") turnHeld();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turnHeld]);

  const onGrab = useCallback((id: number, e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (touches.current.size > 1) return;
    e.stopPropagation();
    if (drag.current) return;
    const body = bodies.get(id);
    if (!body) return;
    setNotice("");
    unlockAudio();
    body.setGravityScale(0, true); // carried: stays dynamic (collides properly), just floats
    drag.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, offX: 0, offZ: 0, started: false, yaw: 0 };
    setActiveId(id);
    sfx.pick();
  }, []);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      // The rotate button is meant to be pressed with a second finger while carrying.
      if ((e.target as Element | null)?.closest?.("[data-keep-drag]")) return;
      if (e.pointerType === "touch") touches.current.add(e.pointerId);
      // second finger: cancel drag so the view can rotate
      if (touches.current.size > 1 && drag.current) {
        const active = drag.current;
        const body = bodies.get(active.id);
        drag.current = null;
        if (body) {
          body.setGravityScale(1, true);
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
          <Physics gravity={[0, -GRAVITY, 0]} timeStep={1 / 120}>
            <Room />
            {blocks.map((b) => (
              <Block key={b.id} data={b} onGrab={onGrab} active={activeId === b.id} />
            ))}
          </Physics>
        </Suspense>
        <ContactShadows position={[0, RUG_H + 0.004, 0]} opacity={0.35} scale={16} blur={2.5} far={4} />
        <DragController drag={drag} />
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

      {/* Rotate the carried block by 90° (second finger while carrying, or the E key) */}
      {activeId !== null && (
        <button
          data-keep-drag
          onPointerDown={(e) => { e.stopPropagation(); turnHeld(); }}
          aria-label="Elem forgatása"
          className="absolute left-3 flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-3xl border-2 border-primary/60 bg-card text-primary shadow-toy transition-transform active:scale-95"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 126px)" }}
        >
          <RotateCw className="h-11 w-11" />
          <span className="font-display text-sm font-extrabold">FORGAT</span>
        </button>
      )}

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
            Egy ujj: emelés, építés, dobás · Közben másik ujj a FORGAT gombon · Két ujj üresen: nézet
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
