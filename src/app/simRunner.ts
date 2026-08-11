import { DEFAULT_PARAMS, flattenParams } from "../params.ts";
import { DEFAULT_COLOR_OPTIONS, resetGenotypeColorCache, type ColorOptions } from "../render/color.ts";
import { collectDescendantIds } from "../render/treeLayout.ts";
import { invalidateTerrainCache } from "../render/worldView.ts";
import type { Creature } from "../sim/creature.ts";
import { applyIntervention, type Intervention } from "../sim/intervention.ts";
import type { RNGSnapshot } from "../sim/rng.ts";
import { createRunConfig, type RunConfig } from "../sim/runConfig.ts";
import { applyInterventionNow, cloneSimState, createSimState, tick, type SimInstance, type SimState } from "../sim/sim.ts";
import type { SpeciationMechanism, Species } from "../sim/taxonomy.ts";
import type { GodTool, SpeedSetting } from "../ui/controls.ts";

const ALL_MECHANISMS: SpeciationMechanism[] = ["founder-population", "allopatric", "sympatric", "founder"];

const MAX_SPEED_BUDGET_MS = 40;

/** Shared brush knobs; each tool reinterprets radius/strength/duration for its own purpose (see applyToolAtPoint). */
export interface BrushSettings {
  radius: number;
  strength: number;
  durationTicks: number;
  seedCount: number;
}

const DEFAULT_BRUSH: BrushSettings = {
  radius: 15,
  strength: 0.5,
  durationTicks: 0,
  seedCount: 20,
};

/**
 * A resumable point-in-time snapshot of everything undo needs to restore exactly: not just
 * SimState, but the RNG stream position (a plain state clone with no RNG snapshot can be undone
 * visually, but every subsequent draw diverges from what would have happened had the undone
 * action never occurred) and the scenario-replay cursor (a meteor struck mid-scenario-playback
 * must not leave already-fired scripted interventions re-queued to fire again after undo).
 */
interface SimulationCheckpoint {
  state: SimState;
  rng: RNGSnapshot;
  loggedInterventionCount: number;
  scenarioIndex: number;
}

/**
 * Owns all mutable runtime state for one browser session: the live sim instance, playback
 * state, display options, and (Phase 3) the active god-mode tool and brush settings. main.ts
 * should hold no state of its own beyond DOM references — everything that needs to survive a
 * restart or feed a future feature belongs here instead of as another module-level `let`.
 */
export class SimRunner {
  sim: SimInstance;
  playing = false;
  speed: SpeedSetting = 1;
  selectedCreatureId: number | null = null;
  readonly colorOptions: ColorOptions = { ...DEFAULT_COLOR_OPTIONS };

  activeTool: GodTool | null = null;
  readonly brush: BrushSettings = { ...DEFAULT_BRUSH };

  selectedSpeciesId: number | null = null;
  lineageFilter: Set<number> | null = null;
  mechanismFilter: Set<SpeciationMechanism> = new Set(ALL_MECHANISMS);
  /** First point of an in-progress barrier drag (barrierStamp needs two points, everything else needs one). */
  private barrierDragStart: { x: number; y: number } | null = null;
  private meteorCheckpoint: SimulationCheckpoint | null = null;
  /** A loaded scenario's pre-scripted interventions, sorted by tick, still waiting to fire as play advances. */
  private scenarioQueue: Intervention[] = [];
  private scenarioIndex = 0;

  constructor(seed: number) {
    this.sim = createSimState(seed, DEFAULT_PARAMS);
  }

  restart(seed: number): void {
    this.sim = createSimState(seed, DEFAULT_PARAMS);
    this.selectedCreatureId = null;
    this.selectedSpeciesId = null;
    this.lineageFilter = null;
    this.meteorCheckpoint = null;
    this.scenarioQueue = [];
    this.scenarioIndex = 0;
    resetGenotypeColorCache();
  }

  /** Loads a run config (seed + params + a pre-scripted intervention log) and starts it fresh at
   * tick 0 — interventions fire automatically as play reaches their recorded tick, exactly
   * reproducing how they were originally applied. This is what makes an exported run a shareable
   * "scenario" rather than just a save file: press play and watch it unfold. Crucially, this now
   * runs with the CONFIG's own recorded params, not whatever DEFAULT_PARAMS happens to be in the
   * build that opens it — see sim/runConfig.ts. Does not mutate `config`. */
  loadScenario(config: RunConfig): void {
    this.sim = createSimState(config.seed, flattenParams(config.params));
    this.scenarioQueue = [...config.interventionLog].sort((a, b) => a.tick - b.tick);
    this.scenarioIndex = 0;
    this.selectedCreatureId = null;
    this.selectedSpeciesId = null;
    this.lineageFilter = null;
    this.meteorCheckpoint = null;
    resetGenotypeColorCache();
  }

  exportScenario(): RunConfig {
    return createRunConfig(this.sim.seed, this.sim.params, this.sim.interventionLog);
  }

  togglePlaying(): boolean {
    this.playing = !this.playing;
    return this.playing;
  }

  setSpeed(speed: SpeedSetting): void {
    this.speed = speed;
  }

  /** Pauses and advances exactly one tick. */
  stepOnce(): void {
    this.playing = false;
    this.stepOneTick();
  }

  select(creatureId: number | null): void {
    this.selectedCreatureId = creatureId;
  }

  setDeuteranopiaSafe(enabled: boolean): void {
    this.colorOptions.deuteranopiaSafe = enabled;
  }

  /** Advances the sim according to the current play/speed state. No-op while paused. */
  advance(): void {
    if (!this.playing) return;

    if (this.speed === "max") {
      const start = performance.now();
      while (performance.now() - start < MAX_SPEED_BUDGET_MS) {
        this.stepOneTick();
      }
    } else {
      for (let i = 0; i < this.speed; i++) {
        this.stepOneTick();
      }
    }
  }

  /** Fires any scripted-scenario interventions due at the current tick, then advances one tick. */
  private stepOneTick(): void {
    while (this.scenarioIndex < this.scenarioQueue.length && this.scenarioQueue[this.scenarioIndex].tick === this.sim.state.tick) {
      const intervention = this.scenarioQueue[this.scenarioIndex];
      applyIntervention(this.sim.state, this.sim.rng, this.sim.params, intervention);
      this.sim.interventionLog.push(intervention);
      this.scenarioIndex++;
    }
    tick(this.sim.state, this.sim.rng, this.sim.params);
  }

  /** The selected creature, or null. Clears the selection if that creature has since died. */
  selectedCreature(): Creature | null {
    if (this.selectedCreatureId === null) return null;
    const found = this.sim.state.creatures.find((c) => c.id === this.selectedCreatureId) ?? null;
    if (!found) this.selectedCreatureId = null;
    return found;
  }

  selectSpecies(speciesId: number | null): void {
    this.selectedSpeciesId = speciesId;
  }

  selectedSpecies(): Species | null {
    if (this.selectedSpeciesId === null) return null;
    return this.sim.state.taxonomy.species.get(this.selectedSpeciesId) ?? null;
  }

  /** Filters the World view to only the currently-selected species and everything descended from it. */
  filterToSelectedLineage(): void {
    if (this.selectedSpeciesId === null) return;
    this.lineageFilter = collectDescendantIds(this.sim.state.taxonomy, this.selectedSpeciesId);
  }

  clearLineageFilter(): void {
    this.lineageFilter = null;
  }

  setMechanismFilter(mechanisms: Set<SpeciationMechanism>): void {
    this.mechanismFilter = mechanisms;
  }

  setActiveTool(tool: GodTool | null): void {
    this.activeTool = tool;
    this.barrierDragStart = null;
  }

  /** True while a barrier's start point has been placed and is waiting for its end point. */
  isDraggingBarrier(): boolean {
    return this.barrierDragStart !== null;
  }

  /**
   * Applies the active tool at a world-space point. barrierStamp needs two points, so the first
   * call records a start point and returns without applying anything; the second call draws the
   * line and applies. Every other tool applies immediately on the first call. No-op if no tool
   * is selected (i.e. the canvas is in plain inspect mode).
   */
  useToolAt(x: number, y: number): void {
    const tool = this.activeTool;
    if (!tool) return;

    if (tool === "barrierStamp") {
      if (!this.barrierDragStart) {
        this.barrierDragStart = { x, y };
        return;
      }
      const start = this.barrierDragStart;
      this.barrierDragStart = null;
      this.apply("barrierStamp", {
        x1: start.x,
        y1: start.y,
        x2: x,
        y2: y,
        width: this.brush.radius,
        targetPassability: 1 - this.brush.strength,
        formationTicks: this.brush.durationTicks,
      });
      invalidateTerrainCache(this.sim.state.terrain);
      return;
    }

    switch (tool) {
      case "raiseTerrain":
        this.apply("raiseTerrain", { x, y, radius: this.brush.radius, strength: this.brush.strength * 2 });
        invalidateTerrainCache(this.sim.state.terrain);
        return;
      case "lowerTerrain":
        this.apply("lowerTerrain", { x, y, radius: this.brush.radius, strength: this.brush.strength * 2 });
        invalidateTerrainCache(this.sim.state.terrain);
        return;
      case "dropFoodR":
        this.apply("dropFood", { x, y, radius: this.brush.radius, foodType: 0, density: this.brush.strength * 4 });
        return;
      case "dropFoodB":
        this.apply("dropFood", { x, y, radius: this.brush.radius, foodType: 1, density: this.brush.strength * 4 });
        return;
      case "drought":
        this.apply("drought", { x, y, radius: this.brush.radius, multiplier: 1 - this.brush.strength, durationTicks: Math.max(this.brush.durationTicks, 1) });
        return;
      case "bloom":
        this.apply("bloom", { x, y, radius: this.brush.radius, multiplier: 1 + this.brush.strength * 4, durationTicks: Math.max(this.brush.durationTicks, 1) });
        return;
      case "meteor":
        this.meteorCheckpoint = this.createCheckpoint();
        this.apply("meteor", { x, y, radius: this.brush.radius, craterRecoveryTicks: this.brush.durationTicks });
        invalidateTerrainCache(this.sim.state.terrain);
        return;
      case "seedFounders":
        this.apply("seedFounders", { x, y, spreadRadius: Math.max(this.brush.radius / 4, 1), count: this.brush.seedCount, genome: "random" as const });
        return;
    }
  }

  canUndoMeteor(): boolean {
    return this.meteorCheckpoint !== null;
  }

  /**
   * Restores state from right before the last meteor and drops that meteor from the log, so the
   * log stays a truthful record of what actually happened (as if it never struck) — including
   * rewinding the RNG stream and the scenario-replay cursor, so continued play afterward is
   * exactly as if the meteor (and everything it perturbed downstream) had never happened, not an
   * approximation that quietly diverges from then on.
   */
  undoLastMeteor(): void {
    if (!this.meteorCheckpoint) return;
    this.restoreCheckpoint(this.meteorCheckpoint);
    this.meteorCheckpoint = null;
    invalidateTerrainCache(this.sim.state.terrain);
  }

  private createCheckpoint(): SimulationCheckpoint {
    return {
      state: cloneSimState(this.sim.state),
      rng: this.sim.rng.snapshot(),
      loggedInterventionCount: this.sim.interventionLog.length,
      scenarioIndex: this.scenarioIndex,
    };
  }

  private restoreCheckpoint(checkpoint: SimulationCheckpoint): void {
    this.sim.state = checkpoint.state;
    this.sim.rng.restore(checkpoint.rng);
    this.sim.interventionLog.length = checkpoint.loggedInterventionCount;
    this.scenarioIndex = checkpoint.scenarioIndex;
  }

  private apply<Tool extends Intervention["tool"]>(tool: Tool, params: Extract<Intervention, { tool: Tool }>["params"]): void {
    applyInterventionNow(this.sim, this.sim.params, tool, params);
  }
}
