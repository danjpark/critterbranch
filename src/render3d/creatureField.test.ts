import { describe, expect, it } from "vitest";
import { deriveMorphology, type MorphologySource } from "../sim/morphology.ts";
import { createCreatureField } from "./creatureField.ts";

/**
 * The visible half of "watch creatures evolve" (SPEC.md Addendum 25), now asserted through the
 * instanced field (Addendum 26). deriveMorphology's own tests cover the numbers; these cover that
 * the RIG reflects them — a fin dimension that never reaches the screen is worth nothing, and that
 * gap is invisible to a morphology-only test.
 *
 * Instance counts turn out to be a more direct assertion than the old per-mesh `visible` flags:
 * "this creature contributed one fin instance" IS the statement that it has a fin.
 */

function source(overrides: Partial<MorphologySource> = {}): MorphologySource {
  return { speed: 1, size: 1, carnivory: 0, senseRadius: 5, aquaticAdaptation: 0, ...overrides };
}

/** Renders exactly one creature and returns the per-part instance counts. */
function countsForOne(overrides: Partial<MorphologySource> = {}): Record<string, number> {
  const field = createCreatureField();
  field.begin();
  field.add(10, 0, 10, 0, deriveMorphology(source(overrides)), "rgb(200, 200, 200)");
  field.commit();
  const counts = field.counts();
  field.dispose();
  return counts;
}

describe("createCreatureField", () => {
  it("draws the always-present parts once per creature (two ears, four legs)", () => {
    const counts = countsForOne();
    expect(counts.body).toBe(1);
    expect(counts.head).toBe(1);
    expect(counts.snout).toBe(1);
    expect(counts.tail).toBe(1);
    expect(counts.ear).toBe(2);
    expect(counts.leg).toBe(4);
  });

  describe("emergent features", () => {
    it("gives a land herbivore neither fin nor fangs", () => {
      const counts = countsForOne();
      expect(counts.fin).toBe(0);
      expect(counts.fang).toBe(0);
    });

    it("gives a fully aquatic creature a fin", () => {
      expect(countsForOne({ aquaticAdaptation: 1 }).fin).toBe(1);
    });

    it("gives a full carnivore a fang on each side", () => {
      expect(countsForOne({ carnivory: 1 }).fang).toBe(2);
    });

    it("keeps fins and fangs independent — a land predator has fangs but no fin", () => {
      const counts = countsForOne({ carnivory: 1, aquaticAdaptation: 0 });
      expect(counts.fang).toBe(2);
      expect(counts.fin).toBe(0);
    });

    // That the fin GROWS continuously rather than snapping to full size is deriveMorphology's
    // property and is tested there, against the number itself. Re-asserting it here would mean
    // decoding a transform out of an instance buffer by index — brittle, and testing Three.js's
    // matrix composition rather than anything this module decides.
    it("starts contributing a fin only once past the emergence threshold", () => {
      expect(countsForOne({ aquaticAdaptation: 0.3 }).fin).toBe(0);
      expect(countsForOne({ aquaticAdaptation: 0.7 }).fin).toBe(1);
    });
  });

  // A creature that dies, or is filtered out of view, is simply not queued — there is no per-entity
  // teardown to get wrong. This is the property that replaced the old Map-of-models lifecycle.
  it("drops instances for creatures that are no longer queued, with no explicit removal", () => {
    const field = createCreatureField();
    const morphology = deriveMorphology(source());

    field.begin();
    for (let i = 0; i < 5; i++) field.add(i, 0, 0, 0, morphology, "rgb(200, 200, 200)");
    field.commit();
    expect(field.counts().body).toBe(5);

    field.begin();
    field.add(0, 0, 0, 0, morphology, "rgb(200, 200, 200)");
    field.commit();
    expect(field.counts().body).toBe(1);

    field.begin();
    field.commit();
    expect(field.counts().body).toBe(0);
    field.dispose();
  });

  // Instanced buffers are sized at construction, so a population larger than the initial capacity
  // has to trigger a rebuild rather than silently dropping the overflow.
  it("grows past its initial capacity instead of dropping creatures", () => {
    const field = createCreatureField();
    const morphology = deriveMorphology(source());
    const population = 500; // well past every part's initial capacity

    field.begin();
    for (let i = 0; i < population; i++) field.add(i, 0, 0, 0, morphology, "rgb(200, 200, 200)");
    field.commit();

    expect(field.counts().body).toBe(population);
    expect(field.counts().leg).toBe(population * 4);
    expect(field.counts().ear).toBe(population * 2);
    field.dispose();
  });
});
