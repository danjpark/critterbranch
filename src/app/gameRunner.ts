import { DEFAULT_PARAMS } from "../params.ts";
import type { ChallengeDefinition } from "../game/challenges/challenge.ts";
import { evaluateChallenge, type ChallengeStatus } from "../game/challengeRuntime.ts";
import { evaluateEraDiscoveries } from "../game/discovery/discoveryJournal.ts";
import { beginEraEvolution, finishEra } from "../game/era.ts";
import { captureEraSnapshot, computeEraDelta, computeNotableTraitShifts, type EraSnapshot, type EraSummary } from "../game/eraSummary.ts";
import { continueToTerraform, createGame, type Game } from "../game/game.ts";
import type { GameMode, GameState } from "../game/gameState.ts";
import type { GameObjective } from "../game/objectives/objective.ts";
import { applyTerraformCommand, type TerraformBudgetState, type TerraformResult } from "../game/terraform.ts";
import { isEcosystemStable } from "../sim/equilibrium.ts";
import { cloneSimState, tick, type SimState } from "../sim/sim.ts";
import type { RNGSnapshot } from "../sim/rng.ts";
import type { GodTool, SpeedSetting } from "../ui/controls.ts";
import { DEFAULT_RAMP_CONFIG, rampedTicksPerFrame } from "./pacing.ts";
import { DEFAULT_BRUSH, resolveToolApplication, type BrushSettings } from "./toolMapping.ts";

/** Shorter than the classic sandbox's 10,000-tick roadmap default — keeps "Advance Era" feeling
 * responsive for a first playable slice. Not scientifically tuned, just a placeholder like the
 * roadmap's own terraform costs (see game/terraform.ts). */
const GAME_ERA_CONFIG = { ticksPerEra: 2000 };

/** Matches SimRunner's own "max" speed budget — how long a single frame is allowed to spend
 * ticking before yielding, so the tab stays responsive even at max speed. */
const MAX_SPEED_BUDGET_MS = 40;

/** Equilibrium early-end (see stepEraAdvance) never fires before this fraction of the era's ticks
 * has run, even if the ecosystem looks stable — avoids a trivial near-instant "era" that never gave
 * anything a chance to happen. Empirically, real eras never approach stability this early anyway
 * (see sim/equilibrium.ts's tuning note) — this is a floor for safety, not a binding constraint in
 * practice. See SPEC.md Addendum 13. */
const EQUILIBRIUM_MIN_ERA_FRACTION = 0.25;

/** A named, session-only save point a player can jump back to later without losing any other
 * saved point — see app/gameRunner.ts's class doc and the "like a git branch" framing this was
 * built to match. Restoring one doesn't delete or invalidate the others. */
export interface GameCheckpoint {
  id: string;
  name: string;
  era: number;
  tick: number;
  createdAt: number;
}

interface StoredCheckpoint extends GameCheckpoint {
  gameStateSnapshot: GameState;
  simStateSnapshot: SimState;
  rngSnapshot: RNGSnapshot;
  interventionLogLength: number;
  budgetSnapshot: TerraformBudgetState | null;
}

/**
 * Owns runtime state for Game Mode: the headless Game (src/game/*) plus the UI-only bits it
 * needs to drive a browser session (active tool, brush, animated era-advance progress,
 * checkpoints). Deliberately separate from app/simRunner.ts's SimRunner (the pre-existing
 * continuous free-play tool) rather than a shared base class — the two have almost nothing in
 * common beyond "holds a sim instance and a brush," and forcing them into one hierarchy would
 * couple Game Mode's phase/budget rules to SimRunner's play/pause/speed rules for no real benefit.
 */
export class GameRunner {
  game: Game;
  activeTool: GodTool | null = null;
  readonly brush: BrushSettings = { ...DEFAULT_BRUSH };
  lastEraSummary: EraSummary | null = null;
  lastTerraformError: string | null = null;
  /** How fast stepEraAdvance() ticks per render frame — same speed vocabulary as SimRunner's
   * classic play controls, so the two feel consistent. */
  speed: SpeedSetting = 10;
  private barrierDragStart: { x: number; y: number } | null = null;
  /** Non-null while an era advance is in progress (see advanceEra()/stepEraAdvance()) — the tick
   * stepEraAdvance() is ticking toward. */
  private eraTargetTick: number | null = null;
  private eraBeforeSnapshot: EraSnapshot | null = null;
  /** Non-null once isEcosystemStable() has fired this era — the tick fast-forwarding began at.
   * SPEC.md Addendum 19: this only changes ANIMATION speed for the rest of the era, never how many
   * ticks actually get simulated — the era still always reaches eraTargetTick exactly, matching
   * game.ts's headless advanceGameEra byte-for-byte instead of silently under-simulating. */
  private fastForwardFromTick: number | null = null;
  private checkpoints: StoredCheckpoint[] = [];
  private nextCheckpointId = 1;

  constructor(mode: GameMode, seed: number, challenge?: ChallengeDefinition) {
    this.game = createGame({ mode, seed, params: DEFAULT_PARAMS, eraConfig: GAME_ERA_CONFIG, challenge });
  }

  restart(mode: GameMode, seed: number, challenge?: ChallengeDefinition): void {
    this.game = createGame({ mode, seed, params: DEFAULT_PARAMS, eraConfig: GAME_ERA_CONFIG, challenge });
    this.activeTool = null;
    this.barrierDragStart = null;
    this.lastEraSummary = null;
    this.lastTerraformError = null;
    this.eraTargetTick = null;
    this.eraBeforeSnapshot = null;
    this.fastForwardFromTick = null;
    this.checkpoints = [];
  }

  setActiveTool(tool: GodTool | null): void {
    this.activeTool = tool;
    this.barrierDragStart = null;
  }

  isDraggingBarrier(): boolean {
    return this.barrierDragStart !== null;
  }

  setSpeed(speed: SpeedSetting): void {
    this.speed = speed;
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

  /** True except while actively animating (evolution phase) — includes discovery, so the button
   * never goes permanently unresponsive after an era finishes: see advanceEra()'s auto-continue
   * below, which was a real reported bug ("I click it and then can't click it again") caused by
   * discovery requiring a separate, easy-to-miss "Continue to terraform" click first. */
  canAdvanceEra(): boolean {
    return this.game.gameState.phase !== "evolution";
  }

  isAdvancingEra(): boolean {
    return this.eraTargetTick !== null;
  }

  /** Begins an animated era advance: enters the evolution phase immediately and records the
   * target tick. The actual ticking happens incrementally via stepEraAdvance(), called once per
   * render frame, so the player can watch terrain/creatures change in real time — see the
   * roadmap feedback this was built for: "seeing the last image and the result is too hard to
   * follow." If called while still reviewing the previous era's discovery summary, this
   * auto-continues to terraform first (same effect as clicking continueToTerraform()) rather than
   * requiring that as a separate click — the explicit Continue button still exists for players who
   * just want to review and pause. */
  advanceEra(): void {
    if (!this.canAdvanceEra()) return;
    if (this.game.gameState.phase === "discovery") {
      continueToTerraform(this.game);
      this.lastEraSummary = null;
    }
    this.eraBeforeSnapshot = captureEraSnapshot(this.game);
    beginEraEvolution(this.game.gameState);
    this.eraTargetTick = this.game.sim.state.evolution.tick + this.game.eraConfig.ticksPerEra;
  }

  /** Fraction (0-1) of the current era-advance's ticks completed, or null when no era is
   * advancing — drives the progress bar so the player can see roughly how long is left instead of
   * just an indeterminate "Evolution running…" label. */
  eraProgress(): number | null {
    if (this.eraTargetTick === null || this.eraBeforeSnapshot === null) return null;
    const total = this.eraTargetTick - this.eraBeforeSnapshot.tick;
    if (total <= 0) return 1;
    const done = this.game.sim.state.evolution.tick - this.eraBeforeSnapshot.tick;
    return Math.min(1, Math.max(0, done / total));
  }

  /** Ticks the sim toward the current era's target according to `speed` — exactly the same
   * per-frame budget SimRunner.advance() uses for the classic sandbox's speed controls, so both
   * feel consistent. Numeric speeds ramp up from a slow floor over the era's opening stretch (see
   * app/pacing.ts) so the eventful early ticks are actually watchable instead of blowing by at full
   * speed immediately; "max" bypasses the ramp entirely (a player who picked max already opted out
   * of watching slowly). No-op unless an era advance is in progress (see advanceEra()). Finalizes
   * (increments era, enters discovery, builds the EraSummary) once the target tick is reached —
   * always exactly the target, never fewer (SPEC.md Addendum 19). Once the ecosystem has gone quiet
   * for a while (see sim/equilibrium.ts and SPEC.md Addendum 13), animation switches to the same
   * max-speed budget loop `speed === "max"` uses for the rest of the era instead of the ramped
   * per-frame rate — a dead tail with nothing left to watch blows by in a couple of frames instead
   * of grinding out slowly, but every tick between here and the target still actually runs, so the
   * simulated outcome stays identical to a headless replay of the same log. */
  stepEraAdvance(): void {
    const target = this.eraTargetTick;
    if (target === null) return;
    const { state, rng, params } = this.game.sim;
    const before = this.eraBeforeSnapshot!;

    if (this.speed === "max" || this.fastForwardFromTick !== null) {
      const start = performance.now();
      while (state.evolution.tick < target && performance.now() - start < MAX_SPEED_BUDGET_MS) {
        tick(state, rng, params);
      }
    } else {
      const ticksSinceEraStart = state.evolution.tick - before.tick;
      const perFrame = rampedTicksPerFrame(this.speed, ticksSinceEraStart, DEFAULT_RAMP_CONFIG);
      for (let i = 0; i < perFrame && state.evolution.tick < target; i++) {
        tick(state, rng, params);
      }
    }

    if (state.evolution.tick >= target) {
      this.finalizeEraAdvance(this.fastForwardFromTick);
      this.fastForwardFromTick = null;
      return;
    }

    if (this.fastForwardFromTick !== null) return; // already fast-forwarding, nothing left to decide

    const totalEraTicks = target - before.tick;
    const elapsedFraction = (state.evolution.tick - before.tick) / totalEraTicks;
    if (elapsedFraction < EQUILIBRIUM_MIN_ERA_FRACTION) return;

    const obs = state.observations;
    if (isEcosystemStable(obs.populationHistory, obs.traitHistory, obs.taxonomyEvents)) {
      this.fastForwardFromTick = state.evolution.tick;
    }
  }

  private finalizeEraAdvance(fastForwardedFromTick: number | null): void {
    const before = this.eraBeforeSnapshot!;
    finishEra(this.game.gameState);
    const after = captureEraSnapshot(this.game);
    const newDiscoveries = evaluateEraDiscoveries(this.game);
    this.lastEraSummary = {
      before,
      after,
      delta: computeEraDelta(before, after),
      notableTraitShifts: computeNotableTraitShifts(this.game, before.tick, after.tick),
      fastForwardedFromTick,
      newDiscoveries,
    };
    this.eraTargetTick = null;
    this.eraBeforeSnapshot = null;
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

  /** Saves a named, session-only snapshot of the full current game state. Multiple checkpoints
   * coexist independently — saving or restoring one never touches another (see restoreCheckpoint). */
  saveCheckpoint(name: string): void {
    const trimmed = name.trim();
    const { game } = this;
    this.checkpoints.push({
      id: String(this.nextCheckpointId++),
      name: trimmed || `Checkpoint ${this.checkpoints.length + 1}`,
      era: game.gameState.era,
      tick: game.sim.state.evolution.tick,
      createdAt: Date.now(),
      gameStateSnapshot: { ...game.gameState },
      simStateSnapshot: cloneSimState(game.sim.state),
      rngSnapshot: game.sim.rng.snapshot(),
      interventionLogLength: game.sim.interventionLog.length,
      budgetSnapshot: game.budget ? { ...game.budget } : null,
    });
  }

  listCheckpoints(): GameCheckpoint[] {
    return this.checkpoints.map(({ id, name, era, tick: checkpointTick, createdAt }) => ({ id, name, era, tick: checkpointTick, createdAt }));
  }

  /** Jumps the live game back to a saved checkpoint — a "branch," not an undo: every other
   * checkpoint stays right where it was, restorable at any time, until explicitly deleted (see
   * deleteCheckpoint). The intervention log truncates to what had actually happened as of the
   * checkpoint, same as the log's existing truthfulness guarantee for the classic sandbox's
   * meteor undo — continued play from here appends fresh, on this branch. */
  restoreCheckpoint(id: string): boolean {
    const checkpoint = this.checkpoints.find((c) => c.id === id);
    if (!checkpoint) return false;

    const { game } = this;
    game.gameState = { ...checkpoint.gameStateSnapshot };
    game.sim.state = cloneSimState(checkpoint.simStateSnapshot);
    game.sim.rng.restore(checkpoint.rngSnapshot);
    game.sim.interventionLog.length = checkpoint.interventionLogLength;
    game.budget = checkpoint.budgetSnapshot ? { ...checkpoint.budgetSnapshot } : null;

    this.eraTargetTick = null;
    this.eraBeforeSnapshot = null;
    this.lastEraSummary = null;
    this.activeTool = null;
    this.barrierDragStart = null;
    return true;
  }

  /** Discards a checkpoint — "collapsing" a branch you're no longer interested in. */
  deleteCheckpoint(id: string): void {
    this.checkpoints = this.checkpoints.filter((c) => c.id !== id);
  }
}
