import { DEFAULT_PARAMS } from "../params.ts";
import type { ChallengeDefinition } from "../game/challenges/challenge.ts";
import { evaluateChallenge, type ChallengeStatus } from "../game/challengeRuntime.ts";
import type { EraSummary } from "../game/eraSummary.ts";
import { advanceGameEra, continueToTerraform, createGame, type Game } from "../game/game.ts";
import type { GameMode } from "../game/gameState.ts";
import type { GameObjective } from "../game/objectives/objective.ts";
import { applyTerraformCommand, type TerraformResult } from "../game/terraform.ts";
import type { GodTool } from "../ui/controls.ts";
import { DEFAULT_BRUSH, resolveToolApplication, type BrushSettings } from "./toolMapping.ts";

/** Shorter than the classic sandbox's 10,000-tick roadmap default — keeps "Advance Era" feeling
 * responsive for a first playable slice. Not scientifically tuned, just a placeholder like the
 * roadmap's own terraform costs (see game/terraform.ts). */
const GAME_ERA_CONFIG = { ticksPerEra: 2000 };

/**
 * Owns runtime state for Game Mode: the headless Game (src/game/*) plus the UI-only bits it
 * needs to drive a browser session (active tool, brush, last era summary). Deliberately separate
 * from app/simRunner.ts's SimRunner (the pre-existing continuous free-play tool) rather than a
 * shared base class — the two have almost nothing in common beyond "holds a sim instance and a
 * brush," and forcing them into one hierarchy would couple Game Mode's phase/budget rules to
 * SimRunner's play/pause/speed rules for no real benefit.
 */
export class GameRunner {
  game: Game;
  activeTool: GodTool | null = null;
  readonly brush: BrushSettings = { ...DEFAULT_BRUSH };
  lastEraSummary: EraSummary | null = null;
  lastTerraformError: string | null = null;
  private barrierDragStart: { x: number; y: number } | null = null;

  constructor(mode: GameMode, seed: number, challenge?: ChallengeDefinition) {
    this.game = createGame({ mode, seed, params: DEFAULT_PARAMS, eraConfig: GAME_ERA_CONFIG, challenge });
  }

  restart(mode: GameMode, seed: number, challenge?: ChallengeDefinition): void {
    this.game = createGame({ mode, seed, params: DEFAULT_PARAMS, eraConfig: GAME_ERA_CONFIG, challenge });
    this.activeTool = null;
    this.barrierDragStart = null;
    this.lastEraSummary = null;
    this.lastTerraformError = null;
  }

  setActiveTool(tool: GodTool | null): void {
    this.activeTool = tool;
    this.barrierDragStart = null;
  }

  isDraggingBarrier(): boolean {
    return this.barrierDragStart !== null;
  }

  /** Applies the active tool at a world-space point, routed through the budget/phase-checked
   * terraform command layer rather than the sim directly — see game/terraform.ts. */
  useToolAt(x: number, y: number): TerraformResult | null {
    const tool = this.activeTool;
    if (!tool) return null;

    const resolved = resolveToolApplication(tool, x, y, this.brush, this.barrierDragStart);
    if (resolved.kind === "awaitingSecondPoint") {
      this.barrierDragStart = { x, y };
      return null;
    }
    this.barrierDragStart = null;

    const result = applyTerraformCommand(this.game, resolved.tool, resolved.params);
    this.lastTerraformError = result.ok ? null : result.reason;
    return result;
  }

  canAdvanceEra(): boolean {
    return this.game.gameState.phase === "terraform";
  }

  advanceEra(): void {
    if (!this.canAdvanceEra()) return;
    this.lastEraSummary = advanceGameEra(this.game);
  }

  canContinueToTerraform(): boolean {
    return this.game.gameState.phase === "discovery";
  }

  continueToTerraform(): void {
    if (!this.canContinueToTerraform()) return;
    continueToTerraform(this.game);
    this.lastEraSummary = null;
  }

  challengeStatus(): ChallengeStatus | null {
    return evaluateChallenge(this.game);
  }

  objectives(): GameObjective[] {
    return this.game.challenge?.objectives ?? [];
  }
}
