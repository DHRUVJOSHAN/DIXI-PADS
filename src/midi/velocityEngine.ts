export const MIN_VELOCITY = 30;
export const MAX_VELOCITY = 127;

/**
 * Position-based velocity curve with subtle [-2, +2] humanization.
 * Top edge of pad -> 30, bottom edge of pad -> 127.
 */
export function computePadVelocity(
  touchY: number,
  padTop: number,
  padHeight: number,
  randomFn: () => number = Math.random
): number {
  const safeHeight = Math.max(1, padHeight);
  const rawP = (touchY - padTop) / safeHeight;
  const p = Math.max(0, Math.min(1, rawP));

  const expScale = (Math.exp(3 * p) - 1) / (Math.exp(3) - 1);
  const base = MIN_VELOCITY + Math.round((MAX_VELOCITY - MIN_VELOCITY) * expScale);

  // Uniform integer jitter in [-2, +2]
  const jitter = Math.floor(randomFn() * 5) - 2;
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, base + jitter));
}
