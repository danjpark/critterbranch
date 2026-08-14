import { describe, expect, it } from "vitest";
import type { GodTool } from "../ui/controls.ts";
import { resolveToolApplication, type BrushSettings } from "./toolMapping.ts";

const brush: BrushSettings = { radius: 20, strength: 0.25, durationTicks: 0, seedCount: 12 };

describe("resolveToolApplication", () => {
  it.each<[GodTool, unknown]>([
    ["raiseTerrain", { kind: "apply", tool: "raiseTerrain", params: { x: 40, y: 60, radius: 20, strength: 0.5 } }],
    ["lowerTerrain", { kind: "apply", tool: "lowerTerrain", params: { x: 40, y: 60, radius: 20, strength: 0.5 } }],
    ["plantTree", { kind: "apply", tool: "plantTree", params: { x: 40, y: 60, radius: 20, count: 12 } }],
    ["drought", { kind: "apply", tool: "drought", params: { x: 40, y: 60, radius: 20, multiplier: 0.75, durationTicks: 1 } }],
    ["bloom", { kind: "apply", tool: "bloom", params: { x: 40, y: 60, radius: 20, multiplier: 2, durationTicks: 1 } }],
    ["meteor", { kind: "apply", tool: "meteor", params: { x: 40, y: 60, radius: 20, craterRecoveryTicks: 0 } }],
    ["seedFounders", { kind: "apply", tool: "seedFounders", params: { x: 40, y: 60, spreadRadius: 5, count: 12, genome: "random" } }],
    ["raiseSeaLevel", { kind: "apply", tool: "raiseSeaLevel", params: { strength: 0.25 } }],
    ["lowerSeaLevel", { kind: "apply", tool: "lowerSeaLevel", params: { strength: 0.25 } }],
  ])("maps %s to the intervention shared by Classic and Game modes", (tool, expected) => {
    expect(resolveToolApplication(tool, 40, 60, brush, null)).toEqual(expected);
  });

  it("waits for a second point before constructing a barrier", () => {
    expect(resolveToolApplication("barrierStamp", 40, 60, brush, null)).toEqual({ kind: "awaitingSecondPoint" });
  });

  it("maps both barrier points and every brush setting on the second click", () => {
    const barrierBrush = { ...brush, durationTicks: 80 };
    expect(resolveToolApplication("barrierStamp", 40, 60, barrierBrush, { x: 10, y: 20 })).toEqual({
      kind: "apply",
      tool: "barrierStamp",
      params: { x1: 10, y1: 20, x2: 40, y2: 60, width: 20, targetPassability: 0.75, formationTicks: 80 },
    });
  });

  it("keeps founder spread visible even when the brush radius is tiny", () => {
    const tinyBrush = { ...brush, radius: 2 };
    expect(resolveToolApplication("seedFounders", 40, 60, tinyBrush, null)).toMatchObject({
      params: { spreadRadius: 1 },
    });
  });
});
