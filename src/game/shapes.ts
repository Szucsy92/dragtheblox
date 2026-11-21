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
export const BLOCK_SCALE = 2.125;
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

/** Tray choices; retain full definitions for geometry and existing physics helpers. */
export const SELECTABLE_SHAPES = SHAPES.filter((shape) => shape.kind !== "half" && shape.kind !== "cone");

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
export const GROUP_BLOCK = 0x00010005; // blocks: collide with blocks + ground
// The carried block touches only the ground, the walls and its own passengers (the blocks resting on it), so
// it can never shove or plough through the rest of the castle, while the stack on top is carried by real friction.
export const GROUP_HELD = 0x0002000c;
export const GROUP_PASSENGER = 0x00090007; // blocks riding on the carried block: collide with everything else too
export const GROUP_GROUND = 0x0004ffff; // rug and walls: collide with everything

// ---- World ----
export const PLAY_AREA = 12.4; // twice the original 6.2 radius
/** The rug has real thickness: this is the height of the walkable ground, visuals and physics agree. */
export const RUG_H = 0.05;
/** Carried blocks are kept at least this far inside the rim (the wall colliders start at PLAY_AREA - 0.04). */
export const ARENA_MARGIN = 0.15;
export const GRAVITY = 9.81 * SIZE_RATIO;

// ---- Feel constants ----
export const SPAWN_HEIGHT = 3.2; // centre height of a new block above the rug (was 7: too hard a landing)
export const DRAG_LIFT = 0.3; // carried blocks float this far above the rug
export const HOVER_GAP = 0.06; // carried blocks float this far above a tower top (tiny, soft drop)
export const CARRY_GAIN = 14; // 1/s: how eagerly a carried block follows the finger
export const CARRY_MAX = 14; // u/s: cap, so a carried block cannot fire the others away
export const ROT_GAIN = 14; // 1/s: how fast a carried block turns to its target yaw
export const ROT_MAX = 14; // rad/s
export const THROW_MIN = 3; // gesture speed (u/s) at release on the floor: slower = gentle place, faster = throw
/** Gesture speed above which a throw is coming: the lift assistant steps aside (and releasing over a tower throws). */
export const FLICK_SPEED = 6;
export const THROW_MAX = 24;

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
export const SNAP_RANGE = 0.25;
/** Inside this fraction of the range the magnet is exact; outside it eases off smoothly to nothing (no jumps). */
export const SNAP_HARD = 0.6;
/** Edge alignment (flush edges, centres) wins over the plain grid when it is nearly as close. */
export const SNAP_EDGE_BIAS = 0.7;
/** Gap left when two blocks are pulled together on the same level (touching, not overlapping). */
export const CONTACT_EPS = 0.004;

// ---- Carry dynamics ----
/** A carried block leans into the direction it is moved, like a weight on the finger. */
export const TILT_PER_SPEED = 0.025; // rad per u/s
export const TILT_MAX = 0.22; // rad (about 12°)
/** Fraction of the carry velocity a released (not magnet-locked) block keeps: a natural little slide. */
export const RELEASE_KEEP = 0.35;
