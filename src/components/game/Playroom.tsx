import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, ContactShadows } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { Trash2, RotateCw } from "lucide-react";
import {
  BLOCK_SCALE, SELECTABLE_SHAPES, TOY_COLORS, shapeDef, halfExtents, type BlockData, type ShapeKind,
  GRAVITY, ROT_GAIN, ROT_MAX, THROW_MIN, FLICK_SPEED,
  RUG_H, DRAG_LIFT, PLAY_AREA, RELEASE_KEEP,
} from "@/game/shapes";
import { clampArena, computeCarry, overlapsOther, pickBlock, pickSpawn, worldHalf, HALF_PI } from "@/game/placement";
import { carryVelocity, gestureVelocity, leanFor, supportedAbove, throwVelocity, type MotionSample } from "@/game/manipulation";
import { bodies, kinds, poseOf, snapshot, setCarried, setPassenger } from "@/game/registry";
import { sfx, unlockAudio } from "@/game/audio";
import { Block } from "./Block";
import { Room } from "./Room";
import { ShapeIcon } from "./ShapeIcon";
import { Button } from "@/components/ui/button";

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
  last: { x: number; y: number; z: number; yaw: number; snapped: boolean } | null;
  /** Smoothed carry velocity (for the lean) and the previous magnet state (for the haptic tick). */
  vx: number;
  vz: number;
  wasSnapped: boolean;
  /** Support under the carried block on the previous frame (hysteresis). */
  sticky: number | null;
  /** Preferred yaw; the player turns it with the rotate button. */
  yaw: number;
  /** Blocks resting on the carried one when it was grabbed: they ride along by friction. */
  load: number[];
  /** Recent finger positions on the carry plane (for the throw). */
  samples: MotionSample[];
}

/** Let go of the held block and its passengers: gravity on, back to normal blocks. */
function endCarry(d: DragState) {
  const body = bodies.get(d.id);
  if (body) setCarried(body, false);
  for (const id of d.load) {
    const p = bodies.get(id);
    if (p) setPassenger(p, false);
  }
}

const tmpV = new THREE.Vector3();
const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
const UP = new THREE.Vector3(0, 1, 0);
const curQ = new THREE.Quaternion();
const tgtQ = new THREE.Quaternion();
const errQ = new THREE.Quaternion();
const eul = new THREE.Euler();
const leanQ = new THREE.Quaternion();
const leanAxis = new THREE.Vector3();

/** Short tick on phones that support it (a no-op elsewhere). */
const buzz = (ms: number) => {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
};

const MARK_FREE = new THREE.Color("#ffffff");
const MARK_SNAP = new THREE.Color("#7dffb0");

/**
 * Carries the held block. The block stays a normal dynamic body (gravity off) and is steered with
 * velocities, so it can never sink into the rug or other blocks and nothing "pops" when it is let go.
 * Also draws the landing marker: a flat footprint on whatever surface the block would land on.
 */
function DragController({ drag, onAbort }: { drag: React.MutableRefObject<DragState | null>; onAbort: () => void }) {
  const { camera, gl } = useThree();
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const rectRef = useRef<THREE.Mesh>(null);
  const roundRef = useRef<THREE.Mesh>(null);
  const markMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }),
    [],
  );

  const frame = () => {
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
    const carryLevel = RUG_H + hyHeld + DRAG_LIFT;
    plane.constant = -carryLevel;
    const hit = ray.ray.intersectPlane(plane, tmpV);
    // Passengers ride on the carried block: they are neither supports nor obstacles for it.
    const others = snapshot(d.id).filter((x) => !d.load.includes(x.id));
    // Intent: if the finger points AT another block (a tower image on screen), aim at its top, so the carried
    // block rises early, while the finger is still over the tower, and goes up there.
    const o = ray.ray.origin, dir = ray.ray.direction;
    // Not on the first touch (a block behind the one just grabbed must not steal it), and only what is in
    // front of the floor point.
    const moved = Math.hypot(d.x - d.x0, d.y - d.y0) > 14;
    const now = performance.now();
    if (hit) {
      d.samples.push({ time: now, x: hit.x, z: hit.z });
      d.samples = d.samples.filter((s) => now - s.time <= 160);
    }
    const gesture = gestureVelocity(d.samples, now);
    // A flick means a throw is coming: the assistant steps aside so the block can be thrown AT a tower.
    const flick = Math.hypot(gesture.x, gesture.z) >= FLICK_SPEED;
    const pick = moved && !flick
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
    const aimX = pick ? pick.x : (hit?.x ?? t.x) + d.offX;
    const aimZ = pick ? pick.z : (hit?.z ?? t.z) + d.offZ;
    const res = flick
      ? clampArena({ x: aimX, z: aimZ, y: carryLevel, yaw: d.yaw, top: RUG_H, supportId: null, snapped: false }, kind)
      : computeCarry({
          kind, x: aimX, z: aimZ, yaw: d.yaw, heldY: t.y, stickyId: pick ? pick.id : d.sticky, others,
        });
    d.last = { x: res.x, y: res.y, z: res.z, yaw: res.yaw, snapped: res.snapped };
    if (res.snapped && !d.wasSnapped) buzz(8); // a tiny tick when the block clicks into place
    d.wasSnapped = res.snapped;
    d.sticky = res.supportId;

    // Position: steer by velocity (capped), never teleport. The passengers are carried by contact only.
    const cv = carryVelocity({ x: res.x - t.x, y: res.y - t.y, z: res.z - t.z });
    body.setLinvel(cv, true);
    d.vx += (cv.x - d.vx) * 0.2;
    d.vz += (cv.z - d.vz) * 0.2;
    for (const id of d.load) bodies.get(id)?.wakeUp();

    // Orientation: turn upright and to the target yaw by angular velocity along the shortest path.
    const r = body.rotation();
    curQ.set(r.x, r.y, r.z, r.w);
    tgtQ.setFromAxisAngle(UP, res.yaw);
    // Dynamics: the carried block leans into the motion (not with a passenger stack on it, not while the
    // magnet holds it level, and only slightly right above a support).
    if (d.load.length === 0 && !res.snapped) {
      const lean = leanFor({ x: d.vx, y: 0, z: d.vz }, res.supportId !== null ? 0.07 : undefined);
      if (lean.angle > 0) tgtQ.premultiply(leanQ.setFromAxisAngle(leanAxis.set(lean.x, 0, lean.z), lean.angle));
    }
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
  };

  // An exception inside the frame loop would freeze the whole game: drop the drag instead.
  useFrame(() => {
    try {
      frame();
    } catch (err) {
      console.error("Drag aborted:", err);
      onAbort();
    }
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
    for (const id of Array.from(bodies.keys())) {
      const b = bodies.get(id);
      const p = poseOf(id);
      if (!b || !p) continue;
      const { t, q } = p;
      try {
        if (!Number.isFinite(t.x + t.y + t.z)) {
          // A broken (NaN) body would poison the camera framing and the placement maths: put it back.
          b.setTranslation({ x: 0, y: 3, z: 0 }, true);
          b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
          continue;
        }
        if (!Number.isFinite(q.x + q.y + q.z + q.w)) b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        const r = Math.hypot(t.x, t.z);
        if (r > PLAY_AREA + 0.3 || t.y < -1) {
          const k = r > 1e-6 ? Math.min(1, (PLAY_AREA * 0.6) / r) : 1;
          b.setTranslation({ x: t.x * k, y: Math.max(t.y, 0) + 2.5, z: t.z * k }, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      } catch {
        bodies.delete(id);
        kinds.delete(id);
      }
    }
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
    if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z + tgt.x + tgt.y + tgt.z)) {
      // Recover from a poisoned camera (a black, frozen screen): back to the start view.
      camera.position.set(14, 14, 22);
      tgt.set(0, 1.5, 0);
      userDist.current = null;
      return;
    }
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
    for (const id of Array.from(bodies.keys())) {
      const k = kinds.get(id);
      const p = k ? poseOf(id) : null;
      if (!k || !p) continue;
      const top = p.t.y + worldHalf(k, p.q)[1];
      if (Number.isFinite(top)) H = Math.max(H, top);
    }
    const d = drag.current;
    if (d?.last) H = Math.max(H, d.last.y + BLOCK_SCALE / 2); // the carried block's own top

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
  const probe = useRef<{ camera: THREE.Camera; gl: THREE.WebGLRenderer } | null>(null);

  const clearAll = useCallback(() => {
    drag.current = null;
    setActiveId(null);
    setTrashHot(false);
    bodies.clear();
    kinds.clear();
    setBlocks([]);
  }, []);

  const overTrash = useCallback((x: number, y: number) => {
    const r = trashEl.current?.getBoundingClientRect();
    if (!r) return false;
    const pad = 28;
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  }, []);

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
      // The block is about to be deleted. Only its passengers go back to normal (they simply fall); the carried
      // block never gets its collisions back: it overlaps the castle and would blast it apart for a frame.
      for (const id of d.load) {
        const p = bodies.get(id);
        if (p) setPassenger(p, false);
      }
      bodies.delete(d.id);
      kinds.delete(d.id);
      setBlocks((b) => b.filter((bl) => bl.id !== d.id));
      sfx.trash();
      return;
    }
    if (body) {
      endCarry(d);
      // Over a tower only a hard flick throws; on the floor a smaller gesture does.
      const v = throwVelocity(gestureVelocity(d.samples, performance.now()), d.sticky !== null ? FLICK_SPEED : THROW_MIN);
      if (v) {
        body.setLinvel(v, true);
        body.setAngvel({ x: v.z * 0.3, y: 0, z: -v.x * 0.3 }, true);
      } else {
        // Gentle place. The carried block does not collide with the others, so if it is still on its way
        // (overlapping something) put it on its computed spot first: no pop-out when the physics wakes up.
        const k = kinds.get(d.id);
        const t0 = body.translation();
        const rest = snapshot(d.id).filter((o) => !d.load.includes(o.id));
        if (k && d.last && overlapsOther(k, t0.x, t0.y, t0.z, d.last.yaw, rest)) {
          const dx = d.last.x - t0.x, dy = d.last.y - t0.y, dz = d.last.z - t0.z;
          body.setTranslation({ x: d.last.x, y: d.last.y, z: d.last.z }, true);
          for (const id of d.load) {
            const pb = bodies.get(id);
            if (!pb) continue;
            const pt = pb.translation();
            pb.setTranslation({ x: pt.x + dx, y: pt.y + dy, z: pt.z + dz }, true);
          }
        }
        // Magnet-locked: exact, no leftover motion. Otherwise a natural little slide (the passengers move with it,
        // so the stack does not topple), then it settles under friction.
        const keep = d.last?.snapped ? 0 : RELEASE_KEEP;
        for (const id of [d.id, ...d.load]) {
          const b = bodies.get(id);
          if (!b) continue;
          const lv = b.linvel();
          b.setLinvel({ x: lv.x * keep, y: 0, z: lv.z * keep }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        buzz(10);
      }
    }
    sfx.drop();
  }, [overTrash]);

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

  /** Drop the current drag without placing anything special (second finger, lost pointer, tab hidden, error). */
  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setActiveId(null);
    setTrashHot(false);
    try {
      endCarry(d);
      const body = bodies.get(d.id);
      body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body?.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } catch {
      /* the body is already gone */
    }
  }, []);

  const onGrab = useCallback((id: number, e: ThreeEvent<PointerEvent>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "touch" && !e.isPrimary) return; // a second finger never grabs
    e.stopPropagation();
    if (drag.current) {
      // A new primary pointer means the old one is gone (a lost "up"): recover instead of staying stuck.
      if (e.isPrimary && e.pointerId !== drag.current.pointerId) cancelDrag();
      else return;
    }
    const body = bodies.get(id);
    if (!body) return;
    unlockAudio();
    const all = snapshot();
    const base = all.find(o => o.id === id);
    const load = base ? supportedAbove(base, all) : [];
    setCarried(body, true); // carried: dynamic, floats, touches only the ground and its own passengers
    for (const pid of load) {
      const p = bodies.get(pid);
      if (p) setPassenger(p, true);
    }
    drag.current = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, offX: 0, offZ: 0, started: false, x0: e.clientX, y0: e.clientY, last: null, vx: 0, vz: 0, wasSnapped: false, sticky: null, yaw: 0, load, samples: [] };
    setActiveId(id);
    sfx.pick();
  }, [cancelDrag]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      // The rotate button is meant to be pressed with a second finger while carrying.
      if ((e.target as Element | null)?.closest?.("[data-keep-drag]")) return;
      // A second finger (never the primary pointer) hands the view back to the camera. No pointer bookkeeping
      // that could go stale: if an "up" is ever lost, nothing stays stuck.
      if (e.pointerType === "touch" && !e.isPrimary) cancelDrag();
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      // A mouse button released outside the window sends no "up" here: do not stay stuck to the cursor.
      if (e.pointerType === "mouse" && e.buttons === 0) {
        release(e.clientX, e.clientY);
        return;
      }
      d.x = e.clientX;
      d.y = e.clientY;
      const hot = overTrash(e.clientX, e.clientY);
      setTrashHot((h) => (h === hot ? h : hot));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (d && e.pointerId === d.pointerId) release(e.clientX, e.clientY);
    };
    const away = () => cancelDrag();
    const hidden = () => {
      if (document.hidden) cancelDrag();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [release, overTrash, cancelDrag]);

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
      dragState: () => drag.current,
      velocity: (id: number) => bodies.get(id)?.linvel(),
      setPose: (id: number, x: number, y: number, z: number) => {
        const b = bodies.get(id);
        if (!b) return;
        b.setTranslation({ x, y, z }, true);
        b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
      project,
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
        camera={{ position: [14, 14, 22], fov: 45 }}
        onCreated={() => setTimeout(() => setReady(true), 300)}
        style={{ position: "absolute", inset: 0 }}
      >
        <color attach="background" args={["#0e1222"]} />
        <fog attach="fog" args={["#0e1222", 40, 85]} />
        <hemisphereLight args={["#cfd8ff", "#3a2f4a", 0.7]} />
        <directionalLight
          position={[6, 12, 5]}
          intensity={1.8}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-(PLAY_AREA + 1)}
          shadow-camera-right={PLAY_AREA + 1}
          shadow-camera-top={PLAY_AREA + 1}
          shadow-camera-bottom={-(PLAY_AREA + 1)}
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
        <ContactShadows position={[0, RUG_H + 0.004, 0]} opacity={0.55} scale={(PLAY_AREA + 1) * 2} blur={2.5} far={4} />
        <DragController drag={drag} onAbort={cancelDrag} />
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
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 136px)" }}
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

      {/* One scrollable row; tightly framed previews stay within the tray height. */}
      <div className="absolute inset-x-0 bottom-0 px-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}>
        <div role="group" aria-label="Építőelemek" className="mx-auto flex max-w-xl touch-pan-x gap-1 overflow-x-auto overscroll-x-contain rounded-2xl bg-card/85 p-1.5 shadow-toy backdrop-blur">
          {SELECTABLE_SHAPES.map((s) => (
            <Button
              key={s.kind}
              variant="ghost"
              onClick={() => spawn(s.kind)}
              aria-label={s.label}
              title={s.label}
              className="h-[104px] w-[104px] shrink-0 rounded-none p-0 transition-transform hover:bg-transparent active:scale-90 [&_svg]:size-[104px]"
            >
              <ShapeIcon kind={s.kind} color={nextColor} className="h-full w-full" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
