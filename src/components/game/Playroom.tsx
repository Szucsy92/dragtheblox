import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, ContactShadows } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { Trash2, RotateCw } from "lucide-react";
import {
  SHAPES, TOY_COLORS, shapeDef, halfExtents, type BlockData, type ShapeKind,
  GRAVITY, CARRY_GAIN, CARRY_MAX, ROT_GAIN, ROT_MAX, THROW_MIN, THROW_MAX,
  RUG_H, DRAG_LIFT, PLAY_AREA,
} from "@/game/shapes";
import { computeCarry, overlapsOther, pickBlock, pickSpawn, worldHalf, HALF_PI } from "@/game/placement";
import { bodies, kinds, snapshot, setCarried } from "@/game/registry";
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
  x0: number;
  y0: number;
  /** Last computed target pose (used to place the block cleanly on release). */
  last: { x: number; y: number; z: number; yaw: number } | null;
  /** Support under the carried block on the previous frame (hysteresis). */
  sticky: number | null;
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
    // Floor aim: the finger ray meets a FIXED plane (carry height above the rug), so lifting the block can never
    // feed back into where it is aiming.
    const [, hyHeld] = halfExtents(kind);
    plane.constant = -(RUG_H + hyHeld + DRAG_LIFT);
    const hit = ray.ray.intersectPlane(plane, tmpV);
    const others = snapshot(d.id);
    // Intent: if the finger points AT another block (a tower image on screen), aim at its top, so the carried
    // block rises early, while the finger is still over the tower, and goes up there.
    const o = ray.ray.origin, dir = ray.ray.direction;
    // Not on the first touch (a block behind the one just grabbed must not steal it), and only what is in
    // front of the floor point.
    const moved = Math.hypot(d.x - d.x0, d.y - d.y0) > 14;
    const pick = moved
      ? pickBlock(o.x, o.y, o.z, dir.x, dir.y, dir.z, others, t.y, hit ? hit.distanceTo(o) : Infinity)
      : null;
    if (!hit && !pick) return hide();

    if (!d.started && hit) {
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

    if (!d.started) return hide();
    const aimX = pick ? pick.x : hit!.x + d.offX;
    const aimZ = pick ? pick.z : hit!.z + d.offZ;
    const res = computeCarry({
      kind, x: aimX, z: aimZ, yaw: d.yaw, heldY: t.y, stickyId: pick ? pick.id : d.sticky, others,
    });
    d.last = { x: res.x, y: res.y, z: res.z, yaw: res.yaw };
    d.sticky = res.supportId;

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

/**
 * Safety net: anything that ends up outside the rug or under the floor is put back inside.
 */
function Keeper() {
  useFrame(() => {
    bodies.forEach((b) => {
      const t = b.translation();
      const r = Math.hypot(t.x, t.z);
      if (r > PLAY_AREA + 0.3 || t.y < -1) {
        const k = r > 1e-6 ? Math.min(1, (PLAY_AREA * 0.6) / r) : 1;
        b.setTranslation({ x: t.x * k, y: Math.max(t.y, 0) + 2.5, z: t.z * k }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    });
  });
  return null;
}

/**
 * Keeps the whole castle in view: looks at the middle of the highest tower and backs the camera off when the
 * tower (or the block carried above it) gets tall. It never fights the player: it stands still while the
 * player is orbiting/zooming, and the distance the player chose is restored when the tower is gone.
 */
function AutoFrame({ controls, drag, orbiting }: {
  controls: React.MutableRefObject<any>;
  drag: React.MutableRefObject<DragState | null>;
  orbiting: React.MutableRefObject<boolean>;
}) {
  const { camera } = useThree();
  const userDist = useRef<number | null>(null);
  const autoDist = useRef(0);
  const wasOrbiting = useRef(false);

  useFrame((_, delta) => {
    const ctl = controls.current;
    if (!ctl) return;
    const tgt = ctl.target as THREE.Vector3;
    const dist = camera.position.distanceTo(tgt);
    if (userDist.current === null) { userDist.current = dist; autoDist.current = dist; }
    if (orbiting.current) { wasOrbiting.current = true; return; }
    if (wasOrbiting.current) {
      // The player just finished moving the camera: if the zoom changed by hand, remember it.
      wasOrbiting.current = false;
      if (Math.abs(dist - autoDist.current) > 0.4) userDist.current = dist;
      autoDist.current = dist;
      return;
    }

    let H = 0;
    bodies.forEach((b, id) => {
      const k = kinds.get(id);
      if (!k) return;
      const t = b.translation(), q = b.rotation();
      H = Math.max(H, t.y + worldHalf(k, q)[1]);
    });
    const d = drag.current;
    if (d?.last) H = Math.max(H, d.last.y + 1);

    const wantY = Math.max(1.5, H * 0.45);
    const need = (H + 2) * 2.0; // keeps a tower of height H inside the part of the screen the UI leaves free
    const wantDist = Math.min(ctl.maxDistance ?? 48, Math.max(userDist.current, need));
    const k = 1 - Math.exp(-2.5 * Math.min(delta, 0.1));

    const dy = (wantY - tgt.y) * k;
    tgt.y += dy;
    camera.position.y += dy;
    const nd = dist + (wantDist - dist) * k;
    camera.position.sub(tgt).setLength(nd).add(tgt);
    autoDist.current = nd;
  });
  return null;
}

/** Hands the camera and the canvas to the dev-only handle below (never used for gameplay). */
function CamProbe({ probe }: { probe: React.MutableRefObject<{ camera: THREE.Camera; gl: THREE.WebGLRenderer } | null> }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    probe.current = { camera, gl };
  }, [camera, gl, probe]);
  return null;
}

export default function Playroom() {
  const [blocks, setBlocks] = useState<BlockData[]>([]);
  const [colorIdx, setColorIdx] = useState(0);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [trashHot, setTrashHot] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef<DragState | null>(null);
  const controls = useRef<any>(null);
  const orbiting = useRef(false);
  const trashEl = useRef<HTMLButtonElement>(null);
  const nextId = useRef(1);
  const touches = useRef(new Set<number>());
  const probe = useRef<{ camera: THREE.Camera; gl: THREE.WebGLRenderer } | null>(null);

  const clearAll = useCallback(() => {
    drag.current = null;
    touches.current.clear();
    setActiveId(null);
    setTrashHot(false);
    bodies.clear();
    kinds.clear();
    setBlocks([]);
  }, []);

  const overTrash = (x: number, y: number) => {
    const r = trashEl.current?.getBoundingClientRect();
    if (!r) return false;
    const pad = 28;
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  };

  const spawn = (kind: ShapeKind) => {
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
      sfx.trash();
      return;
    }
    if (body) {
      setCarried(body, false);
      // The carried block does not collide with others, so if it is still on its way (overlapping something)
      // put it on its computed spot first: no pop-out when the physics wakes up.
      const k = kinds.get(d.id);
      const t0 = body.translation();
      if (k && d.last && overlapsOther(k, t0.x, t0.y, t0.z, d.last.yaw, snapshot(d.id))) {
        body.setTranslation({ x: d.last.x, y: d.last.y, z: d.last.z }, true);
      }
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
    unlockAudio();
    setCarried(body, true); // carried: dynamic, floats, collides only with the ground
    drag.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, offX: 0, offZ: 0, started: false, x0: e.clientX, y0: e.clientY, last: null, sticky: null, yaw: 0 };
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
          setCarried(body, false);
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

  // Dev-only handle (dropped from the built app): lets a scripted check read the room, drive it and
  // aim the pointer exactly, so the carry/stack flow can be verified instead of assumed.
  const devApi = useMemo(() => ({}) as Record<string, any>, []);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const project = (x: number, y: number, z: number) => {
      const p = probe.current;
      if (!p) return null;
      const v = new THREE.Vector3(x, y, z).project(p.camera);
      const r = p.gl.domElement.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    };
    const pose = (id: number) => {
      const b = bodies.get(id), k = kinds.get(id);
      if (!b || !k) return null;
      const t = b.translation(), q = b.rotation();
      return { t, q, k };
    };
    Object.assign(devApi, {
      blocks: () => snapshot(),
      spawn,
      clear: clearAll,
      turn: turnHeld,
      towerHeight: () => {
        let H = 0;
        bodies.forEach((b, id) => {
          const k = kinds.get(id);
          if (!k) return;
          const t = b.translation(), q = b.rotation();
          H = Math.max(H, t.y + worldHalf(k, q)[1]);
        });
        return H;
      },
      cameraInfo: () => {
        const p = probe.current, ctl = controls.current;
        if (!p || !ctl) return null;
        return { dist: p.camera.position.distanceTo(ctl.target), targetY: ctl.target.y };
      },
      screenPos: (id: number) => {
        const p = pose(id);
        return p ? project(p.t.x, p.t.y, p.t.z) : null;
      },
      screenTop: (id: number) => {
        const p = pose(id);
        return p ? project(p.t.x, p.t.y + worldHalf(p.k, p.q)[1], p.t.z) : null;
      },
    });
    (window as any).__game = devApi;
  });

  const nextColor = TOY_COLORS[colorIdx % TOY_COLORS.length]!;

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#0e1222] touch-none" data-scene-ready={ready ? "" : undefined}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [9, 9, 14], fov: 45 }}
        onCreated={() => setTimeout(() => setReady(true), 300)}
        style={{ position: "absolute", inset: 0 }}
      >
        <color attach="background" args={["#0e1222"]} />
        <fog attach="fog" args={["#0e1222", 22, 50]} />
        <hemisphereLight args={["#cfd8ff", "#3a2f4a", 0.7]} />
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
        <ContactShadows position={[0, RUG_H + 0.004, 0]} opacity={0.55} scale={16} blur={2.5} far={4} />
        <DragController drag={drag} />
        <CamProbe probe={probe} />
        <Keeper />
        <AutoFrame controls={controls} drag={drag} orbiting={orbiting} />
        <OrbitControls
          ref={controls}
          onStart={() => { orbiting.current = true; }}
          onEnd={() => { orbiting.current = false; }}
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

      {/* Carry actions: only visible while a block is being dragged, small and quiet */}
      <div
        className="pointer-events-none absolute inset-x-0 flex items-end justify-between px-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 84px)" }}
      >
        <button
          data-keep-drag
          tabIndex={-1}
          aria-hidden={activeId === null}
          onPointerDown={(e) => { e.stopPropagation(); turnHeld(); }}
          aria-label="Elem forgatása"
          className={`flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 backdrop-blur transition-all duration-150 active:scale-90 ${
            activeId !== null ? "pointer-events-auto scale-100 opacity-100" : "scale-75 opacity-0"
          }`}
        >
          <RotateCw className="h-6 w-6" />
        </button>
        <button
          ref={trashEl}
          tabIndex={-1}
          aria-hidden={activeId === null}
          aria-label="Kuka: ide húzd a törlendő elemet"
          className={`flex h-14 w-14 items-center justify-center rounded-full border backdrop-blur transition-all duration-150 ${
            activeId === null
              ? "scale-75 border-white/15 bg-white/10 text-white/70 opacity-0"
              : trashHot
                ? "scale-125 border-destructive bg-destructive text-white opacity-100"
                : "scale-100 border-white/15 bg-white/10 text-white/70 opacity-100"
          }`}
        >
          <Trash2 className="h-6 w-6" />
        </button>
      </div>

      {blocks.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-display text-xl font-bold text-white/80 drop-shadow">
          Koppints egy elemre lent!
        </div>
      )}

      {/* Shape tray: low, the icons fill its height */}
      <div className="absolute inset-x-0 bottom-0 px-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}>
        <div className="mx-auto flex max-w-xl overflow-x-auto rounded-2xl bg-card/85 p-1.5 shadow-toy backdrop-blur">
          {SHAPES.map((s) => (
            <button
              key={s.kind}
              onClick={() => spawn(s.kind)}
              aria-label={s.label}
              className="flex h-[52px] min-w-11 flex-1 items-center justify-center rounded-xl transition-transform hover:bg-muted active:scale-90"
            >
              <ShapeIcon kind={s.kind} color={nextColor} className="h-full w-full" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
