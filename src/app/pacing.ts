/** Shared by app/gameRunner.ts (era-advance ramp) and app/simRunner.ts (auto-pace ramp) — see
 * SPEC.md Addendum 13. Both runners animate ticks per render frame; this decides how many. */
export interface RampConfig {
  /** Ticks held at floorSpeedTicks before the ramp begins at all. The opening of an era is where
   * essentially everything happens — a founding population finding food, spreading out, and
   * multiplying — and it is over in a few hundred ticks. Without a hold, even a slow ramp is
   * already accelerating through the part worth watching. */
  holdTicks: number;
  /** Ticks over which speed then eases from floorSpeedTicks up to the target, measured from the
   * end of the hold. */
  rampTicks: number;
  /** The slowest ticks-per-frame the ramp starts at, regardless of the player's chosen target
   * speed — keeps the opening burst of activity watchable instead of blowing by immediately. */
  floorSpeedTicks: number;
}

/**
 * Tuned against the actual complaint (SPEC.md Addendum 23): an era's opening was eventful but
 * blew past in about a second, and the back half read as nothing happening. The back half is
 * already handled — gameRunner fast-forwards it once sim/equilibrium.ts says the ecosystem has
 * gone quiet — so this side of the fix is entirely about giving the front half more wall-clock
 * time.
 *
 * At speed 10 over a 2,000-tick era this spends roughly two thirds of the animation on the first
 * third of the era, where the interesting dynamics actually are; the old linear 300-tick ramp
 * spent about a quarter of it there.
 */
export const DEFAULT_RAMP_CONFIG: RampConfig = { holdTicks: 120, rampTicks: 600, floorSpeedTicks: 1 };

/**
 * Ticks-per-frame for a numeric target speed: held at floorSpeedTicks through the hold window,
 * then eased up to targetTicks across rampTicks. Callers with a "max" speed setting should bypass
 * this entirely — "max" already means "I don't want to watch this slowly," and ramping it would
 * fight the player's own explicit choice.
 *
 * The easing is quadratic (ease-IN) rather than linear on purpose: a linear ramp is already at
 * half speed halfway through the window, so the tail of the ramp — still an interesting stretch —
 * goes by nearly as fast as the settled remainder. Squaring keeps it near the floor for most of
 * the window and does the acceleration late.
 */
export function rampedTicksPerFrame(targetTicks: number, ticksSinceEventful: number, config: RampConfig = DEFAULT_RAMP_CONFIG): number {
  const elapsed = Math.max(0, ticksSinceEventful);
  if (elapsed < config.holdTicks) return Math.max(1, Math.min(config.floorSpeedTicks, targetTicks));
  const rampElapsed = elapsed - config.holdTicks;
  if (rampElapsed >= config.rampTicks || config.rampTicks <= 0) return targetTicks;
  const t = rampElapsed / config.rampTicks;
  const eased = t * t;
  return Math.max(config.floorSpeedTicks, Math.round(config.floorSpeedTicks + (targetTicks - config.floorSpeedTicks) * eased));
}
