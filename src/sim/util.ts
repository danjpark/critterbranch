/** Shared math and toroidal-geometry helpers for the sim. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wraps a coordinate into [0, size). */
export function wrap(value: number, size: number): number {
  const v = value % size;
  return v < 0 ? v + size : v;
}

/** Shortest signed displacement from b to a on a torus of the given size. */
export function torDelta(a: number, b: number, size: number): number {
  let d = a - b;
  d -= Math.round(d / size) * size;
  return d;
}

export function torDist(ax: number, ay: number, bx: number, by: number, width: number, height: number): number {
  const dx = torDelta(ax, bx, width);
  const dy = torDelta(ay, by, height);
  return Math.sqrt(dx * dx + dy * dy);
}
