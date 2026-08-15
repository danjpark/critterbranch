import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { deriveMorphology, type MorphologySource } from "../sim/morphology.ts";
import { createCreatureModel } from "./creatureModel.ts";

/**
 * The visible half of "watch creatures evolve" (SPEC.md Addendum 25). deriveMorphology's own tests
 * cover the numbers; these cover that the RIG actually reflects them — a fin dimension that never
 * reaches the screen is worth nothing, and that gap is invisible to a morphology-only test.
 */

function source(overrides: Partial<MorphologySource> = {}): MorphologySource {
  return { speed: 1, size: 1, carnivory: 0, senseRadius: 5, aquaticAdaptation: 0, ...overrides };
}

function build(overrides: Partial<MorphologySource> = {}) {
  const model = createCreatureModel();
  model.update(deriveMorphology(source(overrides)), "rgb(200, 200, 200)");
  const meshes = model.root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  // Built in a fixed order by createCreatureModel: body, head, earL, earR, snout, tail, fin,
  // fangL, fangR, then four legs.
  return {
    model,
    fin: meshes[6],
    fangL: meshes[7],
    fangR: meshes[8],
    leg: meshes[9],
  };
}

describe("createCreatureModel — emergent features", () => {
  it("gives a land herbivore neither fin nor fangs", () => {
    const { model, fin, fangL, fangR } = build();
    expect(fin.visible).toBe(false);
    expect(fangL.visible).toBe(false);
    expect(fangR.visible).toBe(false);
    model.dispose();
  });

  it("gives a fully aquatic creature a visible fin", () => {
    const { model, fin } = build({ aquaticAdaptation: 1 });
    expect(fin.visible).toBe(true);
    expect(fin.scale.y).toBeGreaterThan(0);
    model.dispose();
  });

  it("gives a full carnivore visible fangs on both sides", () => {
    const { model, fangL, fangR } = build({ carnivory: 1 });
    expect(fangL.visible).toBe(true);
    expect(fangR.visible).toBe(true);
    expect(fangL.position.z).toBeCloseTo(-fangR.position.z, 6);
    model.dispose();
  });

  it("grows the fin taller as aquatic adaptation deepens, rather than switching it on at full size", () => {
    const partial = build({ aquaticAdaptation: 0.7 });
    const full = build({ aquaticAdaptation: 1 });
    expect(partial.fin.visible).toBe(true);
    expect(partial.fin.scale.y).toBeLessThan(full.fin.scale.y);
    partial.model.dispose();
    full.model.dispose();
  });

  it("broadens and shortens the limbs into paddles as a lineage commits to water", () => {
    const land = build({ aquaticAdaptation: 0 });
    const water = build({ aquaticAdaptation: 1 });
    expect(water.leg.scale.y).toBeLessThan(land.leg.scale.y); // shorter
    expect(water.leg.scale.x).toBeGreaterThan(land.leg.scale.x); // broader
    land.model.dispose();
    water.model.dispose();
  });

  it("keeps fins and fangs independent — a land predator has fangs but no fin", () => {
    const { model, fin, fangL } = build({ carnivory: 1, aquaticAdaptation: 0 });
    expect(fangL.visible).toBe(true);
    expect(fin.visible).toBe(false);
    model.dispose();
  });

  // update() runs every frame for every creature, so a creature whose lineage evolves out of a
  // trait has to lose the part again — not keep it because the branch that hides it never ran.
  it("removes a feature again if the morphology regresses", () => {
    const model = createCreatureModel();
    const meshes = model.root.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const fin = meshes[6];

    model.update(deriveMorphology(source({ aquaticAdaptation: 1 })), "rgb(200, 200, 200)");
    expect(fin.visible).toBe(true);

    model.update(deriveMorphology(source({ aquaticAdaptation: 0 })), "rgb(200, 200, 200)");
    expect(fin.visible).toBe(false);
    model.dispose();
  });
});
