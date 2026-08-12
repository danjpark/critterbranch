import { describe, expect, it } from "vitest";
import { cachedGenotypeColor, genotypeColor, okLchToCssRgb } from "./color.ts";
import type { ColorOptions } from "../app/simRunner.ts";
import { createCreature } from "../sim/creature.ts";
import { genomeCentroid, randomGenome, type Genome } from "../sim/genome.ts";
import { RNG } from "../sim/rng.ts";

const DEFAULT_COLOR_OPTIONS: ColorOptions = { deuteranopiaSafe: false, divergenceScale: 0.35 };

function parseRgb(css: string): [number, number, number] {
  const match = css.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  if (!match) throw new Error(`not an rgb() string: ${css}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

describe("okLchToCssRgb", () => {
  it("produces a well-formed rgb() string with channels in [0, 255]", () => {
    const [r, g, b] = parseRgb(okLchToCssRgb(0.6, 0.1, 1.2));
    for (const channel of [r, g, b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("produces a neutral gray at zero chroma, regardless of hue", () => {
    const [r1, g1, b1] = parseRgb(okLchToCssRgb(0.6, 0, 0));
    const [r2, g2, b2] = parseRgb(okLchToCssRgb(0.6, 0, 3.0));
    expect(r1).toBe(g1);
    expect(g1).toBe(b1);
    expect([r1, g1, b1]).toEqual([r2, g2, b2]);
  });

  it("increases perceived lightness as L increases, at fixed chroma/hue", () => {
    const dark = parseRgb(okLchToCssRgb(0.3, 0.1, 1));
    const light = parseRgb(okLchToCssRgb(0.8, 0.1, 1));
    const sum = (c: [number, number, number]) => c[0] + c[1] + c[2];
    expect(sum(light)).toBeGreaterThan(sum(dark));
  });
});

describe("genotypeColor", () => {
  it("is a pure function: identical genome + centroid + options always produce the same color", () => {
    const rng = new RNG(5);
    const genome = randomGenome(rng);
    const centroid = randomGenome(rng);
    expect(genotypeColor(genome, centroid, DEFAULT_COLOR_OPTIONS)).toBe(genotypeColor(genome, centroid, DEFAULT_COLOR_OPTIONS));
  });

  it("renders the founding centroid itself near-gray (minimum chroma)", () => {
    const rng = new RNG(5);
    const genomes = Array.from({ length: 20 }, () => randomGenome(rng));
    const centroid = genomeCentroid(genomes);

    const channelSpread = (css: string) => {
      const [r, g, b] = parseRgb(css);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };

    const centroidSpread = channelSpread(genotypeColor(centroid, centroid, DEFAULT_COLOR_OPTIONS));
    const divergentGenome: Genome = { ...centroid, speed: 3.0, senseRadius: 0, wanderPersistence: 1 };
    const divergentSpread = channelSpread(genotypeColor(divergentGenome, centroid, DEFAULT_COLOR_OPTIONS));

    expect(centroidSpread).toBeLessThan(divergentSpread);
  });

  it("changes output when deuteranopiaSafe is toggled for a genome with a strong hue signal", () => {
    const rng = new RNG(5);
    const centroid = randomGenome(rng);
    const genome: Genome = { ...centroid, speed: 0.2, senseRadius: 20, wanderPersistence: 0 };

    const normal = genotypeColor(genome, centroid, { ...DEFAULT_COLOR_OPTIONS, deuteranopiaSafe: false });
    const safe = genotypeColor(genome, centroid, { ...DEFAULT_COLOR_OPTIONS, deuteranopiaSafe: true });
    expect(normal).not.toBe(safe);
  });
});

describe("cachedGenotypeColor", () => {
  it("returns the same value as the uncached function", () => {
    const rng = new RNG(9);
    const genome = randomGenome(rng);
    const centroid = randomGenome(rng);
    const creature = createCreature({ id: 1, parentId: null, lineageId: 0, genome, x: 0, y: 0, energy: 1, birthTick: 0, rng });

    expect(cachedGenotypeColor(creature, centroid, DEFAULT_COLOR_OPTIONS)).toBe(genotypeColor(genome, centroid, DEFAULT_COLOR_OPTIONS));
  });

  it("picks up a changed option even for a previously-cached creature", () => {
    const rng = new RNG(9);
    const genome: Genome = { ...randomGenome(rng), speed: 0.2, senseRadius: 20, wanderPersistence: 0 };
    const centroid = randomGenome(rng);
    const creature = createCreature({ id: 2, parentId: null, lineageId: 0, genome, x: 0, y: 0, energy: 1, birthTick: 0, rng });

    const before = cachedGenotypeColor(creature, centroid, { ...DEFAULT_COLOR_OPTIONS, deuteranopiaSafe: false });
    const after = cachedGenotypeColor(creature, centroid, { ...DEFAULT_COLOR_OPTIONS, deuteranopiaSafe: true });
    expect(before).not.toBe(after);
  });
});
