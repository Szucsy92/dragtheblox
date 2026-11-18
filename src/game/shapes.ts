// Pure data about the toy blocks: no React, no three.js.
export type ShapeKind =
  | "cube"
  | "brick"
  | "cylinder"
  | "arch"
  | "roof"
  | "cone"
  | "sphere"
  | "half";

export interface ShapeDef {
  kind: ShapeKind;
  label: string;
  /** Half extents in block units (before BLOCK_SCALE): x = width, y = height, z = depth. */
  half: [number, number, number];
  /** Has a flat, level top that other blocks can sit on (magnet / snap target). */
  flatTop: boolean;
  /** Round footprint (the landing marker is drawn as a circle). */
  round: boolean;
}

/** Edge length of the basic cube in world units. The old toys were 1.18. */
export const BLOCK_SCALE = 1.7;
/** How much bigger than the old toys: gravity and speeds scale with it so the motion feels the same. */
const SIZE_RATIO = BLOCK_SCALE / 1.18;

export const SHAPES: ShapeDef[] = [
  { kind: "cube", label: "Kocka", half: [0.5, 0.5, 0.5], flatTop: true, round: false },
  { kind: "brick", label: "Téglatest", half: [1, 0.5, 0.5], flatTop: true, round: false },
  { kind: "cylinder", label: "Henger", half: [0.5, 0.5, 0.5], flatTop: true, round: true },
  { kind: "arch", label: "Boltív", half: [1, 0.6, 0.5], flatTop: true, round: false },
  { kind: "roof", label: "Tető", half: [1, 0.4, 0.5], flatTop: false, round: false },
  { kind: "cone", label: "Kúp", half: [0.5, 0.5, 0.5], flatTop: false, round: true },
  { kind: "sphere", label: "Gömb", half: [0.5, 0.5, 0.5], flatTop: false, round: true },
  { kind: "half", label: "Félgömb", half: [0.6, 0.3, 0.6], flatTop: false, round: true },
];

export const shapeDef = (k: ShapeKind) => SHAPES.find((s) => s.kind === k)!;

/** Half extents in world units. Visual and collider are both built from this, so they always agree. */
export function halfExtents(k: ShapeKind): [number, number, number] {
  const [x, y, z] = shapeDef(k).half;
  return [x * BLOCK_SCALE, y * BLOCK_SCALE, z * BLOCK_SCALE];
}

/** Bright playroom toy colours */
export const TOY_COLORS = [
  "#e63946", // red
  "#f4a020", // orange
  "#ffd60a", // yellow
  "#2a9d4b", // green
  "#1d7fd8", // blue
  "#8e44ad", // purple
  "#ff6fa8", // pink
  "#17bebb", // teal
];

export interface BlockData {
  id: number;
  kind: ShapeKind;
  color: string;
  spawn: [number, number, number];
}

// ---- Collision groups: (membership << 16) | filter ----
// The carried block only collides with the ground and walls, never with other blocks: it cannot shove anything.
export const GROUP_BLOCK = 0x00010005; // blocks: collide with blocks + ground
export const GROUP_HELD = 0x00020004; // carried block: ground + walls only
export const GROUP_GROUND = 0x0004ffff; // rug and walls: collide with everything

// ---- World ----
export const PLAY_AREA = 6.2; // radius of the circular play area (the rug)
/** The rug has real thickness: this is the height of the walkable ground, visuals and physics agree. */
export const RUG_H = 0.05;
export const GRAVITY = 9.81 * SIZE_RATIO;

// ---- Feel constants ----
export const SPAWN_HEIGHT = 3.2; // centre height of a new block above the rug (was 7: too hard a landing)
export const DRAG_LIFT = 0.3; // carried blocks float this far above the rug
export const HOVER_GAP = 0.12; // carried blocks float this far above a tower top (short, soft drop)
export const CARRY_GAIN = 14; // 1/s: how eagerly a carried block follows the finger
export const CARRY_MAX = 14; // u/s: cap, so a carried block cannot fire the others away
export const ROT_GAIN = 14; // 1/s: how fast a carried block turns to its target yaw
export const ROT_MAX = 14; // rad/s
export const THROW_MIN = 6; // u/s: slower than this on release = gentle place, faster = throw
export const THROW_MAX = 10;
export const SHAKE_THRESHOLD = 9; // m/s² of user acceleration
export const SHAKE_IMPULSE = 0.045 * SIZE_RATIO;

// ---- Smart building ----
/** Fraction of the carried block's footprint that must be over another block to count as "on top of it". */
export const SUPPORT_OVERLAP = 0.22;
/** Once on a support, it is kept down to this overlap so the block does not flicker at the edge. */
export const SUPPORT_KEEP = 0.08;
/** Support up-vector must be at least this vertical (cos ≈ 16°) to count as a level surface. */
export const TILT_OK = 0.96;
/** Magnet grid on a flat top, in block units (0.5 = half a cube). */
export const SNAP_STEP = 0.5;
/** Magnet pull range around each grid point, in block units. */
export const SNAP_RANGE = 0.2;
