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
  /** half extents used for dragging / hovering */
  halfHeight: number;
  halfWidth: number;
}

export const SHAPES: ShapeDef[] = [
  { kind: "cube", label: "Kocka", halfHeight: 0.5, halfWidth: 0.5 },
  { kind: "brick", label: "Téglatest", halfHeight: 0.5, halfWidth: 1 },
  { kind: "cylinder", label: "Henger", halfHeight: 0.5, halfWidth: 0.5 },
  { kind: "arch", label: "Boltív", halfHeight: 0.6, halfWidth: 1 },
  { kind: "roof", label: "Tető", halfHeight: 0.4, halfWidth: 1 },
  { kind: "cone", label: "Kúp", halfHeight: 0.5, halfWidth: 0.5 },
  { kind: "sphere", label: "Gömb", halfHeight: 0.5, halfWidth: 0.5 },
  { kind: "half", label: "Félgömb", halfHeight: 0.3, halfWidth: 0.6 },
];

export const shapeDef = (k: ShapeKind) => SHAPES.find((s) => s.kind === k)!;

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

// Feel constants
export const SPAWN_HEIGHT = 7;
export const DRAG_LIFT = 0.25;
export const DRAG_FOLLOW = 16;
export const THROW_MAX = 6;
export const SHAKE_THRESHOLD = 9; // m/s² of user acceleration
export const SHAKE_IMPULSE = 0.045;
export const PLAY_AREA = 5.4; // radius of the compact circular play area
