import { describe, expect, it } from "vitest";
import { initWorld } from "./world.ts";

describe("initWorld", () => {
  it("starts with an empty fruit grid and a neutral regrowth modifier", () => {
    const world = initWorld(10, 10);
    expect(world.fruit.length).toBe(100);
    expect(Array.from(world.fruit).every((v) => v === 0)).toBe(true);
    expect(Array.from(world.regrowthModifier).every((v) => v === 1)).toBe(true);
  });
});
