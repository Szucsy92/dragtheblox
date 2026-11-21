import { describe, expect, it } from 'vitest';
import { BLOCK_SCALE, SELECTABLE_SHAPES, halfExtents } from '@/game/shapes';

describe('building block choices and size', () => {
  it('makes the actual blocks larger than the previous 1.7-unit cubes', () => {
    expect(BLOCK_SCALE).toBeGreaterThan(1.7);
    expect(halfExtents('cube')).toEqual([BLOCK_SCALE / 2, BLOCK_SCALE / 2, BLOCK_SCALE / 2]);
  });

  it('does not offer hemispheres', () => {
    expect(SELECTABLE_SHAPES.map((shape) => shape.kind)).not.toContain('half');
  });

  it('does not offer the cone before the sphere, retaining the other six shapes', () => {
    expect(SELECTABLE_SHAPES.map((shape) => shape.kind)).toEqual(['cube', 'brick', 'cylinder', 'arch', 'roof', 'sphere']);
  });
});