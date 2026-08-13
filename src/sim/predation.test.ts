import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../params.ts";
import { createCreature, type Creature } from "./creature.ts";
import { randomGenome, type Genome } from "./genome.ts";
import { buildCreatureIndex, findBestNearbyCreature, resolvePredation, type PredationAttempt } from "./predation.ts";
import { RNG } from "./rng.ts";
import { initSpeciesBehaviorStats } from "./speciesBehaviorStats.ts";
import { initWorld } from "./world.ts";

function testGenome(overrides: Partial<Genome> = {}): Genome {
  const rng = new RNG(1);
  return { ...randomGenome(rng), ...overrides };
}

function creatureAt(id: number, x: number, y: number, overrides: Partial<Genome> = {}, energy = 10): Creature {
  const rng = new RNG(id + 1);
  return createCreature({ id, parentId: null, lineageId: 0, genome: testGenome(overrides), x, y, energy, birthTick: 0, rng });
}

// attackPower/evasionPower are derived in sim/phenotype.ts (SPEC.md Addendum 11) — see
// phenotype.test.ts's "derives attackPower from size and evasionPower from speed" for that
// coverage. resolvePredation's own tests below exercise the combined contest through it.

describe("buildCreatureIndex / findBestNearbyCreature", () => {
  it("finds the highest-scoring creature within radius, excluding self", () => {
    const world = initWorld(20, 20);
    const params = DEFAULT_PARAMS;
    const seeker = creatureAt(0, 50, 50);
    const near = creatureAt(1, 52, 50, {}, 5); // close but low energy
    const far = creatureAt(2, 55, 50, {}, 20); // farther but high energy
    const index = buildCreatureIndex([seeker, near, far], world, params);

    const best = findBestNearbyCreature(index, 50, 50, 10, seeker.id, (candidate, dist) => candidate.energy / (dist + 1));
    expect(best?.creature.id).toBe(2);
  });

  it("never returns the excluded id, even if it's the only candidate in range", () => {
    const world = initWorld(20, 20);
    const params = DEFAULT_PARAMS;
    const solo = creatureAt(0, 50, 50);
    const index = buildCreatureIndex([solo], world, params);

    const best = findBestNearbyCreature(index, 50, 50, 10, solo.id, (c, dist) => c.energy / (dist + 1));
    expect(best).toBeNull();
  });

  it("ignores candidates outside radius", () => {
    const world = initWorld(20, 20);
    const params = DEFAULT_PARAMS;
    const seeker = creatureAt(0, 50, 50);
    const distant = creatureAt(1, 90, 90);
    const index = buildCreatureIndex([seeker, distant], world, params);

    const best = findBestNearbyCreature(index, 50, 50, 5, seeker.id, (c, dist) => c.energy / (dist + 1));
    expect(best).toBeNull();
  });
});

describe("resolvePredation", () => {
  it("kills prey and credits the predator's energy on a successful roll", () => {
    // size 2 vs speed 0.2 -> attackPower/(attackPower+evasionPower) = 2/2.2, comfortably clears any roll below that.
    const predator = creatureAt(0, 50, 50, { size: 2, carnivory: 1 }, 5);
    const prey = creatureAt(1, 51, 50, { speed: 0.2 }, 8);
    const attempts: PredationAttempt[] = [{ predatorId: 0, preyId: 1 }];
    const stats = initSpeciesBehaviorStats();

    const result = resolvePredation([predator, prey], attempts, new RNG(1), DEFAULT_PARAMS, stats);

    expect(result.find((c) => c.id === 1)).toBeUndefined();
    const survivingPredator = result.find((c) => c.id === 0)!;
    // Full carnivore (carnivory=1) converts the prey's entire energy.
    expect(survivingPredator.energy).toBeCloseTo(5 + 8);
    // The kill is recorded the same way starvation/aging-out deaths already are (M2's
    // birth/death observability shouldn't silently undercount once predation is active).
    expect(stats.bySpecies.get(0)?.deaths).toBe(1);
  });

  it("scales energy gain by the predator's meat specialization, not a flat transfer", () => {
    const predator = creatureAt(0, 50, 50, { size: 2, carnivory: 0.5 }, 5);
    const prey = creatureAt(1, 51, 50, { speed: 0.2 }, 8);
    const attempts: PredationAttempt[] = [{ predatorId: 0, preyId: 1 }];

    const result = resolvePredation([predator, prey], attempts, new RNG(1), DEFAULT_PARAMS, initSpeciesBehaviorStats());

    const survivingPredator = result.find((c) => c.id === 0)!;
    expect(survivingPredator.energy).toBeLessThan(5 + 8);
    expect(survivingPredator.energy).toBeGreaterThan(5);
  });

  it("leaves both creatures untouched on a failed roll", () => {
    // Force failure with an RNG guaranteed to return a value >= any success probability (< 1).
    const alwaysMiss = { next: () => 0.999999 } as unknown as RNG;
    const predator = creatureAt(0, 50, 50, { size: 2, carnivory: 1 }, 5);
    const prey = creatureAt(1, 51, 50, { speed: 3 }, 8);
    const attempts: PredationAttempt[] = [{ predatorId: 0, preyId: 1 }];

    const result = resolvePredation([predator, prey], attempts, alwaysMiss, DEFAULT_PARAMS, initSpeciesBehaviorStats());

    expect(result.map((c) => c.id).sort()).toEqual([0, 1]);
    expect(result.find((c) => c.id === 0)!.energy).toBe(5);
  });

  it("is a no-op when a second attempt targets prey a first attempt already killed this tick", () => {
    const alwaysHit = { next: () => 0 } as unknown as RNG;
    const predatorA = creatureAt(0, 50, 50, { size: 2 }, 5);
    const predatorB = creatureAt(1, 50, 50, { size: 2 }, 5);
    const prey = creatureAt(2, 51, 50, { speed: 0.2 }, 8);
    const attempts: PredationAttempt[] = [
      { predatorId: 0, preyId: 2 },
      { predatorId: 1, preyId: 2 },
    ];

    const result = resolvePredation([predatorA, predatorB, prey], attempts, alwaysHit, DEFAULT_PARAMS, initSpeciesBehaviorStats());

    expect(result.map((c) => c.id).sort()).toEqual([0, 1]);
    // Only the first attempt actually landed and got credited.
    expect(result.find((c) => c.id === 0)!.energy).toBeGreaterThan(5);
    expect(result.find((c) => c.id === 1)!.energy).toBe(5);
  });

  it("is a no-op when the predator isn't in the surviving list (e.g. died of its own starvation this tick)", () => {
    const prey = creatureAt(1, 51, 50, {}, 8);
    const attempts: PredationAttempt[] = [{ predatorId: 999, preyId: 1 }];

    const result = resolvePredation([prey], attempts, new RNG(1), DEFAULT_PARAMS, initSpeciesBehaviorStats());

    expect(result).toHaveLength(1);
    expect(result[0].energy).toBe(8);
  });

  it("returns the same array reference when there are no attempts, as a cheap no-op", () => {
    const creatures = [creatureAt(0, 50, 50)];
    expect(resolvePredation(creatures, [], new RNG(1), DEFAULT_PARAMS, initSpeciesBehaviorStats())).toBe(creatures);
  });
});
