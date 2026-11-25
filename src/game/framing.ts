import { FRAME_DIST_MAX, FRAME_DIST_MIN, FRAME_MIN_RADIUS, FRAME_PAD, PLAY_AREA } from "./shapes";

/** World-space box of a block: centre and half extents. */
export interface FrameBox { x: number; y: number; z: number; hx: number; hy: number; hz: number }

export interface Framing {
  /** Point the camera looks at. */
  cx: number;
  cy: number;
  cz: number;
  /** Camera distance from that point that keeps everything in view. */
  distance: number;
}

/**
 * Where should the camera look, and from how far, so the whole castle (and what is being carried) is in view?
 * The view always covers a ball of at least FRAME_MIN_RADIUS around the blocks, so a few blocks are seen big
 * (zoom in on a wide screen), and the distance grows as the blocks spread out or the tower gets tall (zoom out).
 * The narrow side of the screen decides: a portrait phone needs far more distance than a landscape tablet.
 */
export function frameFor(boxes: FrameBox[], aspect: number, fovDeg: number): Framing {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(0.2, aspect);
  const sinMin = Math.sin(Math.atan(Math.min(tanV, tanH)));
  let cx = 0, cy = 1.5, cz = 0, radius = FRAME_MIN_RADIUS;
  if (boxes.length) {
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x - b.hx); maxX = Math.max(maxX, b.x + b.hx);
      minY = Math.min(minY, b.y - b.hy); maxY = Math.max(maxY, b.y + b.hy);
      minZ = Math.min(minZ, b.z - b.hz); maxZ = Math.max(maxZ, b.z + b.hz);
    }
    cx = (minX + maxX) / 2; cy = (minY + maxY) / 2; cz = (minZ + maxZ) / 2;
    radius = Math.max(FRAME_MIN_RADIUS, Math.hypot((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2) + FRAME_PAD);
    cy = Math.max(1.5, cy);
  }
  const d = Math.hypot(cx, cz), lim = PLAY_AREA * 0.75;
  if (d > lim) { cx *= lim / d; cz *= lim / d; }
  const distance = Math.min(FRAME_DIST_MAX, Math.max(FRAME_DIST_MIN, radius / sinMin));
  return { cx, cy, cz, distance };
}
