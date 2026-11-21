import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { carryVelocity, throwVelocity } from '@/game/manipulation';
import { GRAVITY, BLOCK_SCALE, RUG_H } from '@/game/shapes';

beforeAll(async () => { await RAPIER.init(); });
function room() {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = 1 / 120;
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, RUG_H - 0.5, 0).setFriction(1));
  const blocks = Array.from({ length: 3 }, (_, i) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, RUG_H + BLOCK_SCALE * (i + 0.5), 0).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(BLOCK_SCALE / 2, BLOCK_SCALE / 2, BLOCK_SCALE / 2).setFriction(0.9), body);
    return body;
  });
  for (let i = 0; i < 120; i++) world.step();
  return { world, blocks };
}
it('slow base movement carries the upper tower through contact', () => {
  const { world, blocks } = room();
  const [base, middle, top] = blocks;
  if (!base || !middle || !top) throw new Error('Missing tower');
  base.setGravityScale(0, true);
  for (let i = 0; i < 240; i++) {
    const t = base.translation();
    base.setLinvel(carryVelocity({ x: Math.min(0.8, i / 240 * 0.8) - t.x, y: RUG_H + BLOCK_SCALE / 2 + 0.08 - t.y, z: 0 }), true);
    base.setAngvel({ x: 0, y: 0, z: 0 }, true);
    world.step();
  }
  expect(base.translation().x).toBeGreaterThan(0.35);
  expect(top.translation().x).toBeGreaterThan(0.25);
  expect(Math.abs(top.translation().x - base.translation().x)).toBeLessThan(0.4);
  expect(top.translation().y).toBeGreaterThan(3.8);
  world.free();
});
it('a suddenly pulled base leaves an unstable tower, not a rigid group', () => {
  const { world, blocks } = room();
  const [base, , top] = blocks;
  if (!base || !top) throw new Error('Missing tower');
  base.setGravityScale(0, true);
  for (let i = 0; i < 360; i++) {
    base.setLinvel(i < 30 ? carryVelocity({ x: 5 - base.translation().x, y: 0, z: 0 }) : { x: 0, y: 0, z: 0 }, true);
    world.step();
  }
  expect(top.translation().y).toBeLessThan(3 * BLOCK_SCALE / 1.7);
  world.free();
});
it('a thrown sphere transfers momentum and knocks down the tower', () => {
  const { world, blocks } = room();
  const sizeRatio = BLOCK_SCALE / 1.7;
  const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-5 * sizeRatio, 2.5 * sizeRatio, 0).setCcdEnabled(true));
  world.createCollider(RAPIER.ColliderDesc.ball(BLOCK_SCALE / 2).setFriction(0.9), ball);
  const v = throwVelocity({ x: 20 * Math.sqrt(sizeRatio), y: 0, z: 0 });
  if (!v) throw new Error('No launch');
  ball.setLinvel(v, true);
  for (let i = 0; i < 360; i++) world.step();
  const top = blocks[2];
  if (!top) throw new Error('Missing top');
  expect(top.translation().y).toBeLessThan(3 * sizeRatio);
  expect(Math.abs(top.translation().x)).toBeGreaterThan(1);
  world.free();
});