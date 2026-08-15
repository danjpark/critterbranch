import type { Intervention } from "./intervention.ts";
import {
  DEFAULT_PARAMS,
  DEFAULT_RUN_PARAMS,
  flattenParams,
  groupParams,
  mergeRunParams,
  sanitizeParams,
  type Params,
  type RunParams,
} from "../params.ts";

/** Bump whenever RunConfig's own shape changes in a way `parseRunConfig` needs to migrate. */
export const RUN_CONFIG_SCHEMA_VERSION = 2;
/** Bump on any change to simulation semantics that could affect replay of an existing file (new
 * gene, changed formula, etc.) — not every commit, just ones a reproducibility-conscious user
 * would want visible when comparing an old exported run against a newer build of the app. */
export const ENGINE_VERSION = "0.8.0";
/** Marks a RunConfig migrated from the pre-versioning `{seed, interventionLog}` scenario shape,
 * which never recorded its actual params — see parseRunConfig. Distinct from
 * RUN_CONFIG_SCHEMA_VERSION 1+ so a migrated file is visibly distinguishable from a genuinely
 * recorded one. */
export const LEGACY_SCHEMA_VERSION = 0;

/**
 * A run's entire reproducible identity: the exact seed, the exact parameters it ran with
 * (domain-grouped — see params.ts's RunParams), and every god-mode intervention applied along the
 * way, in application order. Anything with this in hand can reconstruct the run exactly,
 * headlessly or live, regardless of what DEFAULT_PARAMS happens to be in whatever build of the
 * app opens it later (see SPEC.md: "the intervention log is also a saved scenario" — a RunConfig
 * is the fuller version of that promise, now covering params too, not just the seed and
 * interventions).
 */
export interface RunConfig {
  schemaVersion: number;
  engineVersion: string;
  seed: number;
  params: RunParams;
  interventionLog: Intervention[];
}

/**
 * Snapshots a run's identity right now. `params` is the flat, internal shape every sim function
 * actually takes — this groups it into RunParams for storage/export. Copies the intervention log
 * too, so later mutation of the live run (more interventions) can never retroactively alter an
 * already-created RunConfig — the caller is holding a frozen-in-time record, not a live view.
 * Interventions are never mutated after being logged (see sim.ts), so a shallow array copy
 * sharing entry references is safe.
 */
export function createRunConfig(seed: number, params: Params, interventionLog: Intervention[]): RunConfig {
  return {
    schemaVersion: RUN_CONFIG_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    seed,
    params: groupParams(params),
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

/** A grouped RunParams object always has a `world` sub-object; a flat (schema-1) or absent
 * `params` does not — that's the whole shape difference parseRunConfig needs to tell them apart. */
function looksGrouped(params: Record<string, unknown>): boolean {
  return typeof params.world === "object" && params.world !== null;
}

/**
 * Validates and, where possible, migrates unknown input (typically a user-supplied JSON file) into
 * a RunConfig. Returns null if the input isn't usable at all — this is deliberately a shape check,
 * not a full schema validator, just enough to fail loudly before garbage reaches deep into the sim.
 *
 * Two migration paths, both non-fatal:
 * - A pre-versioning scenario file (`{seed, interventionLog}`, no `params` at all) is migrated
 *   onto the CURRENT build's defaults — the seed and intervention log are still perfectly usable
 *   data, they just weren't recorded with explicit params (the concept didn't exist yet). Tagged
 *   LEGACY_SCHEMA_VERSION so callers can tell the difference and, if they want, warn the user that
 *   replay fidelity for a legacy file is only as good as whatever the current defaults happen to be.
 * - A schema-1 file (flat `params`, from before the domain-grouping refactor) is migrated by
 *   grouping it — this is lossless, so it's tagged as a normal current-schema config, not legacy.
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
      params: DEFAULT_RUN_PARAMS,
      interventionLog: candidate.interventionLog,
    };
  }

  const rawParams = candidate.params as Record<string, unknown>;
  // Merge onto defaults rather than trusting the file's params verbatim, so a config saved by an
  // older build that's missing a since-added field still gets a sane value instead of `undefined`
  // propagating into the sim.
  const merged = looksGrouped(rawParams)
    ? mergeRunParams(DEFAULT_RUN_PARAMS, rawParams as Partial<Record<keyof RunParams, unknown>>)
    : groupParams({ ...DEFAULT_PARAMS, ...(rawParams as Partial<Params>) });

  // Merging only guarantees every FIELD is present, never that its VALUE is usable — a file can
  // still carry a string, a NaN, or a zero cadence in a field that silently disables or poisons a
  // whole subsystem downstream. See params.ts's sanitizeParams for which values those are and why
  // each one is dangerous rather than merely unusual.
  const { params } = sanitizeParams(flattenParams(merged));

  return {
    schemaVersion: typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : RUN_CONFIG_SCHEMA_VERSION,
    engineVersion: typeof candidate.engineVersion === "string" ? candidate.engineVersion : "unknown",
    seed: candidate.seed,
    params: groupParams(params),
    interventionLog: candidate.interventionLog,
  };
}
