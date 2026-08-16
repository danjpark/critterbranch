import type { Intervention } from "../sim/intervention.ts";
import type { GodTool } from "../ui/controls.ts";

/** Shared brush knobs; each tool reinterprets radius/strength/duration for its own purpose (see resolveToolApplication). */
export interface BrushSettings {
  radius: number;
  strength: number;
  durationTicks: number;
  seedCount: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
  radius: 15,
  strength: 0.5,
  durationTicks: 0,
  seedCount: 20,
};

export type ToolApplication =
  | { kind: "apply"; tool: Intervention["tool"]; params: Intervention["params"] }
  | { kind: "awaitingSecondPoint" };

/**
 * Pure mapping from a UI god-mode tool + click point + current brush settings to the sim
 * Intervention it resolves to. barrierStamp needs two points: the first call returns
 * "awaitingSecondPoint" and the caller is responsible for remembering the start point and
 * passing it back in as `barrierStart` on the second call. Shared by SimRunner (classic
 * continuous play, unrestricted) and app/gameRunner.ts (era-based Game Mode, budgeted) so both
 * interpret brush settings identically — this only decides WHAT the tool does, never whether
 * it's allowed to run right now (phase/budget legality is the caller's job).
 */
export function resolveToolApplication(
  tool: GodTool,
  x: number,
  y: number,
  brush: BrushSettings,
  barrierStart: { x: number; y: number } | null,
): ToolApplication {
  if (tool === "barrierStamp") {
    if (!barrierStart) return { kind: "awaitingSecondPoint" };
    return {
      kind: "apply",
      tool: "barrierStamp",
      params: {
        x1: barrierStart.x,
        y1: barrierStart.y,
        x2: x,
        y2: y,
        width: brush.radius,
        targetPassability: 1 - brush.strength,
        formationTicks: brush.durationTicks,
      },
    };
  }

  switch (tool) {
    // Strength passes through as the raw 0-1 slider value. It used to be doubled here and then
    // applied to elevation directly, which made one click at maximum move the ground by more than
    // three times the world's entire natural height range; how far a click actually moves terrain
    // is now decided in one place, sim/intervention.ts, scaled against terrainRoughness.
    case "raiseTerrain":
      return { kind: "apply", tool: "raiseTerrain", params: { x, y, radius: brush.radius, strength: brush.strength } };
    case "lowerTerrain":
      return { kind: "apply", tool: "lowerTerrain", params: { x, y, radius: brush.radius, strength: brush.strength } };
    case "raiseCliff":
      return { kind: "apply", tool: "raiseCliff", params: { x, y, radius: brush.radius, strength: brush.strength } };
    case "lowerCliff":
      return { kind: "apply", tool: "lowerCliff", params: { x, y, radius: brush.radius, strength: brush.strength } };
    case "plantTree":
      return { kind: "apply", tool: "plantTree", params: { x, y, radius: brush.radius, count: brush.seedCount } };
    case "drought":
      return {
        kind: "apply",
        tool: "drought",
        params: { x, y, radius: brush.radius, multiplier: 1 - brush.strength, durationTicks: Math.max(brush.durationTicks, 1) },
      };
    case "bloom":
      return {
        kind: "apply",
        tool: "bloom",
        params: { x, y, radius: brush.radius, multiplier: 1 + brush.strength * 4, durationTicks: Math.max(brush.durationTicks, 1) },
      };
    case "meteor":
      return { kind: "apply", tool: "meteor", params: { x, y, radius: brush.radius, craterRecoveryTicks: brush.durationTicks } };
    case "seedFounders":
      return {
        kind: "apply",
        tool: "seedFounders",
        params: { x, y, spreadRadius: Math.max(brush.radius / 4, 1), count: brush.seedCount, genome: "random" as const },
      };
    case "raiseSeaLevel":
      return { kind: "apply", tool: "raiseSeaLevel", params: { strength: brush.strength } };
    case "lowerSeaLevel":
      return { kind: "apply", tool: "lowerSeaLevel", params: { strength: brush.strength } };
  }
}
