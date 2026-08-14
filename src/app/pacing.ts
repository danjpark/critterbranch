/** Shared by app/gameRunner.ts (era-advance ramp) and app/simRunner.ts (auto-pace ramp) — see
 * SPEC.md Addendum 13. Both runners animate ticks per render frame; this decides how many. */
export interface RampConfig {
  /** Ticks (since whatever "eventful moment" the caller is ramping from — era start, or
   * SimRunner's last intervention) over which speed ramps from floorSpeedTicks up to the target. */
  rampTicks: number;
  /** The slowest ticks-per-frame the ramp starts at, regardless of the player's chosen target
   * speed — keeps the opening burst of activity watchable instead of blowing by immediately. */
  floorSpeedTicks: number;
}

export const DEFAULT_RAMP_CONFIG: RampConfig = { rampTicks: 300, floorSpeedTicks: 1 };

/**
 * Ticks-per-frame for a numeric target speed, ramping linearly from floorSpeedTicks up to
 * targetTicks over rampTicks ticks-since-the-last-eventful-moment. Callers with a "max" speed
 * setting should bypass this entirely — "max" already means "I don't want to watch this slowly,"
 * ramping it would fight the player's own explicit choice.
 */
export function rampedTicksPerFrame(targetTicks: number, ticksSinceEventful: number, config: RampConfig = DEFAULT_RAMP_CONFIG): number {
  if (ticksSinceEventful >= config.rampTicks) return targetTicks;
  const t = Math.max(0, ticksSinceEventful) / config.rampTicks;
  return Math.max(config.floorSpeedTicks, Math.round(config.floorSpeedTicks + (targetTicks - config.floorSpeedTicks) * t));
}
