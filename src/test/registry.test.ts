import { beforeEach, describe, expect, it } from 'vitest';
import { bodies, kinds, poseOf, snapshot } from '@/game/registry';

// Minimal stand-ins for Rapier bodies: all the registry needs is translation() / rotation().
const live = (x: number, y: number, z: number) => ({
  translation: () => ({ x, y, z }),
  rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
}) as never;
const freed = () => ({
  translation: () => { throw new Error('null pointer passed to rust'); },
  rotation: () => { throw new Error('null pointer passed to rust'); },
}) as never;

describe('registry', () => {
  beforeEach(() => { bodies.clear(); kinds.clear(); });

  it('reads the pose of a live block', () => {
    bodies.set(1, live(1, 2, 3));
    kinds.set(1, 'cube');
    expect(poseOf(1)?.t.y).toBe(2);
    expect(snapshot().length).toBe(1);
  });

  it('drops a freed body instead of throwing: an exception in the frame loop would freeze the game', () => {
    bodies.set(1, live(0, 1, 0));
    kinds.set(1, 'cube');
    bodies.set(2, freed());
    kinds.set(2, 'brick');
    const snap = snapshot();
    expect(snap.length).toBe(1);
    expect(snap[0]?.id).toBe(1);
    expect(bodies.has(2)).toBe(false);
    expect(kinds.has(2)).toBe(false);
    expect(poseOf(2)).toBeNull();
  });

  it('can exclude the carried block from the snapshot', () => {
    bodies.set(1, live(0, 1, 0)); kinds.set(1, 'cube');
    bodies.set(2, live(3, 1, 0)); kinds.set(2, 'cube');
    expect(snapshot(1).map((o) => o.id)).toEqual([2]);
  });
});
