import type { Intervention } from "./intervention.ts";
import { DEFAULT_PARAMS, type Params } from "../params.ts";

/** Bump whenever RunConfig's own shape changes in a way `parseRunConfig` needs to migrate. */
export const RUN_CONFIG_SCHEMA_VERSION = 1;
/** Bump on any change to simulation semantics that could affect replay of an existing file (new
 * gene, changed formula, etc.) — not every commit, just ones a reproducibility-conscious user
 * would want visible when comparing an old exported run against a newer build of the app. */
export const ENGINE_VERSION = "0.7.0";
/** Marks a RunConfig migrated from the pre-versioning `{seed, interventionLog}` scenario shape,
 * which never recorded its actual params — see parseRunConfig. Distinct from
 * RUN_CONFIG_SCHEMA_VERSION 1+ so a migrated file is visibly distinguishable from a genuinely
 * recorded one. */
export const LEGACY_SCHEMA_VERSION = 0;

/**
 * A run's entire reproducible identity: the exact seed, the exact parameters it ran with, and
 * every god-mode intervention applied along the way, in application order. Anything with this in
 * hand can reconstruct the run exactly, headlessly or live, regardless of what DEFAULT_PARAMS
 * happens to be in whatever build of the app opens it later (see SPEC.md: "the intervention log is
 * also a saved scenario" — a RunConfig is the fuller version of that promise, now covering params
 * too, not just the seed and interventions).
 */
export interface RunConfig {
  schemaVersion: number;
  engineVersion: string;
  seed: number;
  params: Params;
  interventionLog: Intervention[];
}

/**
 * Snapshots a run's identity right now. Copies params and the intervention log so that later
 * mutation of the live run (more interventions, a future params UI change) can never retroactively
 * alter an already-created RunConfig — the caller is holding a frozen-in-time record, not a live
 * view. Params is flat primitives, so a shallow copy is a full copy; interventions are never
 * mutated after being logged (see sim.ts), so a shallow array copy sharing entry references is
 * safe too.
 */
export function createRunConfig(seed: number, params: Params, interventionLog: Intervention[]): RunConfig {
  return {
    schemaVersion: RUN_CONFIG_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    seed,
    params: { ...params },
    interventionLog: [...interventionLog],
  };
}

function isValidInterventionLog(value: unknown): value is Intervention[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).tick === "number" &&
        typeof (entry as Record<string, unknown>).tool === "string" &&
        typeof (entry as Record<string, unknown>).params === "object",
    )
  );
}

/**
 * Validates and, where possible, migrates unknown input (typically a user-supplied JSON file) into
 * a RunConfig. Returns null if the input isn't usable at all — this is deliberately a shape check,
 * not a full schema validator, just enough to fail loudly before garbage reaches deep into the sim.
 *
 * A pre-versioning scenario file (`{seed, interventionLog}`, no `params`) is migrated onto the
 * CURRENT build's DEFAULT_PARAMS rather than rejected outright — the seed and intervention log are
 * still perfectly usable data, they just weren't recorded with explicit params (because the
 * concept didn't exist yet). The migrated config is tagged LEGACY_SCHEMA_VERSION so callers can
 * tell the difference and, if they want, warn the user that replay fidelity for a legacy file is
 * only as good as whatever the current defaults happen to be.
 */
export function parseRunConfig(value: unknown): RunConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.seed !== "number") return null;
  if (!isValidInterventionLog(candidate.interventionLog)) return null;

  if (typeof candidate.params !== "object" || candidate.params === null) {
    return {
      schemaVersion: LEGACY_SCHEMA_VERSION,
      engineVersion: typeof candidate.engineVersion === "string" ? candidate.engineVersion : "pre-1.0 (unrecorded)",
      seed: candidate.seed,
      params: { ...DEFAULT_PARAMS },
      interventionLog: candidate.interventionLog,
    };
  }

  return {
    schemaVersion: typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : LEGACY_SCHEMA_VERSION,
    engineVersion: typeof candidate.engineVersion === "string" ? candidate.engineVersion : "unknown",
    seed: candidate.seed,
    // Merge onto DEFAULT_PARAMS rather than trusting the file's params object verbatim, so a
    // config saved by an older build that's missing a since-added field (like nursingDuration's
    // rate) still gets a sane value instead of `undefined` propagating into the sim.
    params: { ...DEFAULT_PARAMS, ...(candidate.params as Partial<Params>) },
    interventionLog: candidate.interventionLog,
  };
}
