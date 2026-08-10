import type { Params } from "../ui/params.ts";
import type { RNG } from "./rng.ts";
import { clamp01, torDelta } from "./util.ts";

export interface TerrainGrid {
  cols: number;
  rows: number;
  elevation: Float64Array;
  passability: Float64Array;
  fertility: Float64Array;
}

/**
 * Generates elevation as a sum of random Gaussian hills, then derives passability
 * (movement cost multiplier) and fertility (food regrowth multiplier) from it.
 * Deterministic: driven entirely by the passed-in RNG.
 */
export function generateTerrain(rng: RNG, params: Params, cols: number, rows: number): TerrainGrid {
  const elevation = new Float64Array(cols * rows);

  for (let h = 0; h < params.terrainHillCount; h++) {
    const cx = rng.nextRange(0, cols);
    const cy = rng.nextRange(0, rows);
    const radius = rng.nextRange(cols * 0.08, cols * 0.25);
    const amp = rng.nextRange(0.3, 1.0);
    for (let y = 0; y < rows; y++) {
      const dy = torDelta(y, cy, rows);
      for (let x = 0; x < cols; x++) {
        const dx = torDelta(x, cx, cols);
        const d2 = dx * dx + dy * dy;
        elevation[y * cols + x] += amp * Math.exp(-d2 / (2 * radius * radius));
      }
    }
  }

  let maxElevation = 0;
  for (let i = 0; i < elevation.length; i++) {
    maxElevation = Math.max(maxElevation, elevation[i]);
  }
  if (maxElevation > 0) {
    for (let i = 0; i < elevation.length; i++) {
      elevation[i] = (elevation[i] / maxElevation) * params.terrainRoughness;
    }
  }

  const passability = new Float64Array(cols * rows);
  const fertility = new Float64Array(cols * rows);
  for (let i = 0; i < elevation.length; i++) {
    passability[i] = clamp01(1 - params.passabilitySteepness * elevation[i]);
    fertility[i] = clamp01(1 - params.fertilitySteepness * elevation[i]);
  }

  return { cols, rows, elevation, passability, fertility };
}
