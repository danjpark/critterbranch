import type { Params } from "../params.ts";
import type { RNG } from "./rng.ts";
import type { TerrainGrid } from "./terrain.ts";
import { clamp, lerp, torDelta } from "./util.ts";

/** Per-cell food grid, parallel to the terrain grid. Type 0 = R, type 1 = B. */
export interface World {
  cols: number;
  rows: number;
  r: Float64Array;
  b: Float64Array;
  capacityR: Float64Array;
  capacityB: Float64Array;
  /** Per-cell regrowth multiplier, default 1. God-mode drought/bloom brushes scale this temporarily. */
  regrowthModifier: Float64Array;
}

interface FoodPatch {
  x: number;
  y: number;
  type: 0 | 1;
  radius: number;
  capacity: number;
}

export function generateWorld(rng: RNG, params: Params, terrain: TerrainGrid): World {
  const { cols, rows } = terrain;
  const capacityR = new Float64Array(cols * rows);
  const capacityB = new Float64Array(cols * rows);

  if (params.foodMode === "gradient") {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const fracR = 1 - x / cols;
        capacityR[idx] = params.baseCapacity * fracR;
        capacityB[idx] = params.baseCapacity * (1 - fracR);
      }
    }
  } else {
    const poorRadius = lerp(params.richPatchRadius, params.poorPatchRadius, params.patchBimodality);
    const poorCapacity = lerp(params.richPatchCapacity, params.poorPatchCapacity, params.patchBimodality);

    const patches: FoodPatch[] = [];
    for (let i = 0; i < params.richPatchCount; i++) {
      patches.push({
        x: rng.nextRange(0, cols),
        y: rng.nextRange(0, rows),
        type: (i % 2) as 0 | 1,
        radius: params.richPatchRadius,
        capacity: params.richPatchCapacity,
      });
    }
    for (let i = 0; i < params.poorPatchCount; i++) {
      patches.push({
        x: rng.nextRange(0, cols),
        y: rng.nextRange(0, rows),
        type: (i % 2) as 0 | 1,
        radius: poorRadius,
        capacity: poorCapacity,
      });
    }

    // Truncate the Gaussian at 1.5 sigma (keeps ~68% of its mass, close to the visually "solid"
    // core of the bump) instead of letting it fade forever — otherwise dozens of overlapping
    // infinite tails blanket the whole grid in a faint haze of nonzero food, which is what made
    // "sparse, scattered patches" not actually look sparse: every cell had *some* food, just not
    // much of it. A looser cutoff (e.g. 2.5 sigma) still leaves individual patches' footprints
    // large enough to jointly cover most of the grid even at a handful of patches.
    const CUTOFF_SIGMAS = 1.5;
    for (const patch of patches) {
      const target = patch.type === 0 ? capacityR : capacityB;
      const rad = Math.max(patch.radius, 0.5);
      const cutoffDist = rad * CUTOFF_SIGMAS;
      const cutoffDist2 = cutoffDist * cutoffDist;
      for (let y = 0; y < rows; y++) {
        const dy = torDelta(y, patch.y, rows);
        for (let x = 0; x < cols; x++) {
          const dx = torDelta(x, patch.x, cols);
          const d2 = dx * dx + dy * dy;
          if (d2 > cutoffDist2) continue;
          const falloff = Math.exp(-d2 / (2 * rad * rad));
          target[y * cols + x] += patch.capacity * falloff;
        }
      }
    }
  }

  // capacityR/B intentionally does NOT bake in fertility here — fertility is read live in
  // regrowFood instead, so that terrain changes (a god-mode meteor crater, a raised mountain)
  // actually affect food regrowth going forward. Baking it in once at generation time would make
  // any later fertility change (e.g. a crater "recovering over craterRecoveryTicks") a no-op.
  const ambient = params.baseCapacity * params.ambientFoodFraction;
  for (let i = 0; i < capacityR.length; i++) {
    capacityR[i] += ambient;
    capacityB[i] += ambient;
  }

  return {
    cols,
    rows,
    // Start full at the fertility-adjusted ceiling, same as regrowFood would converge to.
    r: capacityR.map((c, i) => c * terrain.fertility[i]),
    b: capacityB.map((c, i) => c * terrain.fertility[i]),
    capacityR,
    capacityB,
    regrowthModifier: new Float64Array(capacityR.length).fill(1),
  };
}

export function regrowFood(world: World, terrain: TerrainGrid, tick: number, params: Params): void {
  const cyclical = clamp(
    1 + params.regrowthCycleAmplitude * Math.sin((2 * Math.PI * tick) / params.regrowthCyclePeriod),
    0,
    2,
  );
  for (let i = 0; i < world.r.length; i++) {
    const rate = params.regrowthRate * cyclical * world.regrowthModifier[i];
    const ceilingR = world.capacityR[i] * terrain.fertility[i];
    const ceilingB = world.capacityB[i] * terrain.fertility[i];
    world.r[i] = Math.min(ceilingR, world.r[i] + rate * ceilingR);
    world.b[i] = Math.min(ceilingB, world.b[i] + rate * ceilingB);
  }
}
