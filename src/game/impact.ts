import { GRAVITY } from "./shapes";

/**
 * Knock strength (0..1) for a contact whose force per unit mass just reached `a`, given the value `prev` one step
 * earlier; 0 means "no sound". Only a sudden jump is an impact: a tall stack steadily pressing on its bottom block
 * (force per mass of several g, constant) must stay silent.
 */
export function impactStrength(a: number, prev: number): number {
  if (a <= 6 * GRAVITY || a <= prev * 2) return 0;
  return Math.min(1, Math.max(0.05, (Math.log10(a) - 1.9) / 2));
}
