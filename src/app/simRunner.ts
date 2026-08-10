import { DEFAULT_PARAMS } from "../params.ts";
import { DEFAULT_COLOR_OPTIONS, resetGenotypeColorCache, type ColorOptions } from "../render/color.ts";
import type { Creature } from "../sim/creature.ts";
import { createSimState, tick, type SimInstance } from "../sim/sim.ts";
import type { SpeedSetting } from "../ui/controls.ts";

const MAX_SPEED_BUDGET_MS = 40;

/**
 * Owns all mutable runtime state for one browser session: the live sim instance, playback
 * state, and display options. main.ts should hold no state of its own beyond DOM references —
 * everything that needs to survive a restart or feed a future feature (Phase 3's intervention
 * log, Phase 4's taxonomy view, etc.) belongs here instead of as another module-level `let`.
 */
export class SimRunner {
  sim: SimInstance;
  playing = false;
  speed: SpeedSetting = 1;
  selectedCreatureId: number | null = null;
  readonly colorOptions: ColorOptions = { ...DEFAULT_COLOR_OPTIONS };

  constructor(seed: number) {
    this.sim = createSimState(seed, DEFAULT_PARAMS);
  }

  restart(seed: number): void {
    this.sim = createSimState(seed, DEFAULT_PARAMS);
    this.selectedCreatureId = null;
    resetGenotypeColorCache();
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
    tick(this.sim.state, this.sim.rng, DEFAULT_PARAMS);
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
        tick(this.sim.state, this.sim.rng, DEFAULT_PARAMS);
      }
    } else {
      for (let i = 0; i < this.speed; i++) {
        tick(this.sim.state, this.sim.rng, DEFAULT_PARAMS);
      }
    }
  }

  /** The selected creature, or null. Clears the selection if that creature has since died. */
  selectedCreature(): Creature | null {
    if (this.selectedCreatureId === null) return null;
    const found = this.sim.state.creatures.find((c) => c.id === this.selectedCreatureId) ?? null;
    if (!found) this.selectedCreatureId = null;
    return found;
  }
}
