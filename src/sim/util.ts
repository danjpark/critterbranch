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

/**
 * Mean position of a set of coordinates on a circle/torus axis of the given period — the
 * wrap-aware replacement for a naive arithmetic mean. A plain average of x-coordinates breaks
 * near the wrap seam: points at x=1 and x=199 on a width-200 world are actually ~2 units apart
 * (the short way, through x=0/200), but `(1+199)/2 = 100` places their "average" on the far side
 * of the map from either of them. Computed the standard way for circular data: average each value
 * as a unit vector on the circle, then take the angle of the resulting vector.
 */
export function circularMean(values: number[], period: number): number {
  let sumCos = 0;
  let sumSin = 0;
  for (const v of values) {
    const angle = (2 * Math.PI * v) / period;
    sumCos += Math.cos(angle);
    sumSin += Math.sin(angle);
  }
  const meanAngle = Math.atan2(sumSin / values.length, sumCos / values.length);
  return wrap((period * meanAngle) / (2 * Math.PI), period);
}

/** Interpolates from a to b along the SHORTEST path on a torus of the given period, not the
 * straight (and possibly long-way-around) line a naive lerp would draw. At t=0 returns a, at
 * t=1 returns b (wrapped), passing through the same wrap seam torDelta would use as the short way. */
export function wrappedLerp(a: number, b: number, t: number, period: number): number {
  return wrap(a + torDelta(b, a, period) * t, period);
}
