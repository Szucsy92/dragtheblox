import { BLOCK_SCALE, FRAME_DIST_MAX, FRAME_DIST_MIN, FRAME_HEADROOM, FRAME_MIN_SPAN, FRAME_PAD, PLAY_AREA } from "./shapes";

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
 * Where should the camera look, and from how far, so the whole castle is in view, with room above it for the next
 * block? Width and height are fitted SEPARATELY, each against its own field of view (the screen is much narrower
 * than tall on a phone, but a tall tower only needs the tall side), and the height is seen from the camera's
 * elevation `pitch`. So a thin tower of any height fits from a steady distance (no constant zooming while
 * building), a wide spread of blocks zooms out, and a few blocks are seen big (more so on a wide screen).
 */
export function frameFor(boxes: FrameBox[], aspect: number, fovDeg: number, pitch = 0.7): Framing {
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(0.2, aspect);
  let minX = -FRAME_MIN_SPAN / 2, maxX = FRAME_MIN_SPAN / 2, minZ = -FRAME_MIN_SPAN / 2, maxZ = FRAME_MIN_SPAN / 2;
  let minY = 0, maxY = BLOCK_SCALE; // the rug, and at least one block of height
  if (boxes.length) {
    minX = minZ = minY = Infinity;
    maxX = maxZ = maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x - b.hx); maxX = Math.max(maxX, b.x + b.hx);
      minY = Math.min(minY, b.y - b.hy); maxY = Math.max(maxY, b.y + b.hy);
      minZ = Math.min(minZ, b.z - b.hz); maxZ = Math.max(maxZ, b.z + b.hz);
    }
    minY = Math.min(minY, 0);
  }
  maxY += FRAME_HEADROOM * BLOCK_SCALE; // room for the next block
  const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
  // At least FRAME_MIN_SPAN around the castle, so a single block is not framed from a hair's breadth.
  const spanX = Math.max(maxX - minX, FRAME_MIN_SPAN), spanZ = Math.max(maxZ - minZ, FRAME_MIN_SPAN);
  const span = Math.max(spanX, spanZ);
  const height = maxY - minY;
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  // What the screen has to show: the castle's width, and its height as seen from the camera's elevation.
  const needH = ((span * 1.25) / 2 + FRAME_PAD) / tanH;
  const needV = ((height * cosP + span * sinP) / 2 + FRAME_PAD) / tanV;
  let cx = cx0, cz = cz0;
  const cy = Math.max(1.5, (minY + maxY) / 2);
  const d = Math.hypot(cx, cz), lim = PLAY_AREA * 0.75;
  if (d > lim) { cx *= lim / d; cz *= lim / d; }
  return { cx, cy, cz, distance: Math.min(FRAME_DIST_MAX, Math.max(FRAME_DIST_MIN, needH, needV)) };
}
