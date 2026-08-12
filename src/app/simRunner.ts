import { DEFAULT_PARAMS, flattenParams } from "../params.ts";
import type { Creature } from "../sim/creature.ts";
import { applyIntervention, type Intervention } from "../sim/intervention.ts";
import type { RNGSnapshot } from "../sim/rng.ts";
import { createRunConfig, type RunConfig } from "../sim/runConfig.ts";
import { applyInterventionNow, cloneSimState, createSimState, tick, type SimInstance, type SimState } from "../sim/sim.ts";
import { collectDescendantIds, type SpeciationMechanism, type Species } from "../sim/taxonomy.ts";
import type { GodTool, SpeedSetting } from "../ui/controls.ts";
import { type BrushSettings, DEFAULT_BRUSH, resolveToolApplication } from "./toolMapping.ts";

export type { BrushSettings } from "./toolMapping.ts";

const ALL_MECHANISMS: SpeciationMechanism[] = ["founder-population", "allopatric", "sympatric", "founder"];

const MAX_SPEED_BUDGET_MS = 40;

/** How a creature's genome maps to a fill color — see render/color.ts's genotypeColor(), which is
 * the only thing that actually interprets these. Defined here (app layer, alongside
 * BrushSettings, another piece of user-adjustable display state SimRunner owns) rather than in
 * render/, so SimRunner never needs to import from render/ just to hold this state — render/
 * modules import this type from here instead. */
export interface ColorOptions {
  /** Restricts hue to the blue<->orange arc instead of the full wheel (diet is otherwise a red/green split). */
  deuteranopiaSafe: boolean;
  /** Raw genetic distance (see sim/genome.ts) that maps to the maximum chroma (0.20). */
  divergenceScale: number;
}

const DEFAULT_COLOR_OPTIONS: ColorOptions = {
  deuteranopiaSafe: false,
  divergenceScale: 0.35,
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
    while (this.scenarioIndex < this.scenarioQueue.length && this.scenarioQueue[this.scenarioIndex].tick === this.sim.state.evolution.tick) {
      const intervention = this.scenarioQueue[this.scenarioIndex];
      applyIntervention(this.sim.state.evolution, this.sim.rng, this.sim.params, intervention);
      this.sim.interventionLog.push(intervention);
      this.scenarioIndex++;
    }
    tick(this.sim.state, this.sim.rng, this.sim.params);
  }

  /** The selected creature, or null. Clears the selection if that creature has since died. */
  selectedCreature(): Creature | null {
    if (this.selectedCreatureId === null) return null;
    const found = this.sim.state.evolution.creatures.find((c) => c.id === this.selectedCreatureId) ?? null;
    if (!found) this.selectedCreatureId = null;
    return found;
  }

  selectSpecies(speciesId: number | null): void {
    this.selectedSpeciesId = speciesId;
  }

  selectedSpecies(): Species | null {
    if (this.selectedSpeciesId === null) return null;
    return this.sim.state.observations.taxonomy.species.get(this.selectedSpeciesId) ?? null;
  }

  /** Filters the World view to only the currently-selected species and everything descended from it. */
  filterToSelectedLineage(): void {
    if (this.selectedSpeciesId === null) return;
    this.lineageFilter = collectDescendantIds(this.sim.state.observations.taxonomy, this.selectedSpeciesId);
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

    const resolved = resolveToolApplication(tool, x, y, this.brush, this.barrierDragStart);
    if (resolved.kind === "awaitingSecondPoint") {
      this.barrierDragStart = { x, y };
      return;
    }
    this.barrierDragStart = null;

    if (resolved.tool === "meteor") this.meteorCheckpoint = this.createCheckpoint();
    this.apply(resolved.tool, resolved.params);
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
