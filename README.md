# Critterbranch

A deterministic, browser-based agent-based evolution simulator. Digital organisms forage on a
toroidal 2D world; traits are heritable and mutate on reproduction. Left running for tens of
thousands of ticks, the population splits on its own into distinct lineages, and the app renders
that history as a phylogenetic tree — that tree is the primary deliverable, not the world map. See
[`SPEC.md`](SPEC.md) for the full design spec and build history, including several addenda
recording direction changes made along the way.

## Architecture: dependency direction

```
src/sim     — no DOM, no canvas, no render imports. Pure simulation domain logic.
     ↑
src/app     — orchestration/runtime (SimRunner: owns the live SimInstance, playback state,
              god-mode tool state, display preferences).
     ↑
src/render  — visualization only (canvas renderers for World/Tree/Muller/Scatter views,
              the competition heatmap overlay, genotype-color mapping).
src/ui      — DOM controls (sidebar panels, sliders, buttons).
```

Arrows point in the direction dependencies are allowed to flow: `sim` depends on nothing else in
the app, `app` may depend on `sim`, and `render`/`ui` may depend on both `app` and `sim`. The
reverse is never allowed — in particular, `src/app/simRunner.ts` has zero imports from
`src/render`. Where SimRunner needs to hold state a renderer also consumes (like `ColorOptions`,
the deuteranopia/divergence-scale display settings), that type is defined in `app/` and `render/`
imports it from there, not the other way around. Caches that live inside a renderer (the terrain
layer, the genotype-color cache) detect their own staleness automatically — a terrain-mutating
intervention bumps `TerrainGrid.revision`, a restart naturally produces new `Creature` objects — so
nothing outside the renderer needs to know a cache exists there at all, let alone invalidate it.

`src/params.ts` is the one exception living at the src root rather than under `sim/` or `ui/`: both
the pure sim core and the render/ui layers depend on it, so it can't live inside either without
inverting that dependency.

## Simulation lifecycle

One call to `tick()` (`src/sim/sim.ts`), in order:

1. Advance any in-progress god-mode effects (a barrier still forming, a crater still recovering).
2. Recompute regrowth-rate overrides from active drought/bloom effects.
3. Advance every fruit tree (`src/sim/trees.ts`): sapling maturity, fruit regrowth into its own
   cell (reading terrain fertility live, so a recovering crater actually affects regrowth going
   forward), and — on a coarser cadence (`treeCrowdingCheckIntervalTicks`) — crowdedness-scaled
   death. Food is a persistent, spatial entity population, not a uniform grid regrow; see
   [`SPEC.md` Addendum 6](SPEC.md).
4. Periodically decay the competition-heatmap consumption grid and the species-behavior
   accumulators (batched every `consumptionDecayIntervalTicks`, not every tick — an
   O(cells)-per-species pass is too expensive to run at full frequency against a
   population-sized simulation).
5. Build a grid-bucketed spatial index of every living creature (`src/sim/predation.ts`) — needed
   so prey-sensing is O(local density) per creature instead of an O(n²) all-pairs scan.
6. Step every creature: sense fruit *and* nearby creatures as potential prey (scored by the same
   mechanism, whichever wins steers the creature that tick — see genome.ts's `carnivory` and
   `gainPerUnit`), steer, move, pay metabolism, then either eat fruit at the landing cell or —
   if it ended within `attackRange` of the prey it was steering toward and isn't on attack
   cooldown — queue a predation attempt (resolved later, not synchronously; see step 8).
7. Reproduce creatures that crossed their energy threshold; cull the dead and the aged-out into
   `nextGeneration`.
8. Resolve every queued predation attempt against `nextGeneration`, in order: a successful attack
   removes the prey and credits the predator's energy (scaled by its own carnivory
   specialization); re-checks both sides are still alive at resolution time, since an earlier
   attempt this same tick may have already killed the same prey, or the predator may have died of
   its own starvation before its attack could land. See `src/sim/predation.ts`'s `resolvePredation`
   doc comment for why this is a separate pass rather than resolved synchronously inside step 6.
9. Apply ongoing parental care (nursing) — a parent transfers energy to each still-dependent child.
10. Update the gene-flow meter (every tick, so it catches every region crossing).
11. Periodically (every `taxonomyIntervalTicks`) run a taxonomy pass: detect species splits and
    extinctions, sample population/trait history.
12. Periodically (every 5,000 ticks) compact dense observation history — see
    [History retention](#history-retention) below.

Steps 1–3, 6–9 operate on `SimState.evolution` (core state: creatures, trees, world, terrain).
Steps 4, 10–12 operate on `SimState.observations` (derived analytics: taxonomy, gene flow,
population/trait history, the consumption grid) — nothing in `evolution` ever depends on
`observations`, which is what lets a new visualization get added without touching creature/world
mechanics at all. Steps 5 and 8 are the one exception to that split: prey-sensing needs a fresh
per-tick spatial index of `evolution.creatures` (not persisted state), and predation resolution
writes back into `evolution.creatures` itself (a kill is a real state change, not an observation).

## Determinism contract

Every simulation function is a pure function of `(seed, params, interventionLog)` — the same
inputs always produce the same run, tick for tick. This is enforced by:

- `Math.random()` is banned in `src/sim/` — the only randomness source is the seeded PCG32 `RNG`
  class (`src/sim/rng.ts`), which supports `snapshot()`/`restore()`/`clone()` for checkpointing
  (used by meteor undo — restoring `SimState` alone isn't enough to make undo exact, since every
  subsequent RNG draw would otherwise diverge from what the run would have produced without it).
- A run's full reproducible identity is a `RunConfig` (`src/sim/runConfig.ts`): `{schemaVersion,
  engineVersion, seed, params, interventionLog}`. `params` is the domain-grouped `RunParams` shape
  (`WorldParams`/`EvolutionParams`/`ReproductionParams`/`TerrainParams`/`TaxonomyParams`/
  `ObservationParams`/`RenderParams`) — the *recorded* params a run actually used, not whatever
  `DEFAULT_PARAMS` happens to be in the build that later opens the file. `groupParams()`/
  `flattenParams()` convert losslessly between this grouped shape and the flat `Params` every sim
  function actually takes; internal sim/render code was never rewritten to take grouped params
  piecemeal, since that would be a much larger, higher-risk change for no behavioral difference —
  the grouping exists at the RunConfig/export boundary.
- `runSimulation(seed, params, interventionLog, totalTicks)` (or `runSimulationFromConfig` for the
  RunConfig-shaped version) replays a run headlessly with nobody present. Live play and headless
  replay of the same log must hash identically (`src/sim/testHash.ts`'s `hashState()`) — this is
  checked directly in tests.

## Scenario / replay format

A `RunConfig` **is** a scenario: seed + params + every god-mode intervention, timestamped by the
tick it was applied. Load one and press play — interventions fire automatically as playback reaches
their recorded tick. `parseRunConfig()` migrates two older shapes on load: a pre-versioning
`{seed, interventionLog}` file with no recorded params at all (tagged `LEGACY_SCHEMA_VERSION`,
falls back to current defaults), and a schema-1 file with flat (ungrouped) params. Both migrations
merge onto current defaults field-by-field, so a field added after a file was saved comes back as a
sane default instead of `undefined`.

## Taxonomy caveat

Species in this simulator are an **inferred classification under explicit, tunable thresholds**,
not a biological ground truth the simulation somehow knows. `updateTaxonomy()`
(`src/sim/taxonomy.ts`) periodically looks for a genuinely bimodal split within each living
species (gap-detection on a 1D projection between the two most genetically distant members, not
just "any bisection with separated centroids" — the latter is true of any population with variance
at all, bimodal or not). A candidate split must persist across `speciationConfirmationPasses`
consecutive taxonomy passes (default 2) before being promoted to a real species, so a single
fluctuating pass can't fork a permanent lineage. Every promoted split is tagged with a
`SpeciationMechanism` (`allopatric`/`sympatric`/`founder`) inferred from `SpeciationEvidence` — the
raw measurements (genetic/spatial separation, minimum barrier passability along the pair's
*shortest wrapped path* on the torus, founder count, divergence dominance ratio) the classification
was based on, attached to both the transient `SpeciationEvent` and the persistent `Species` record,
so "why did this get called allopatric" has an actual answer beyond the label itself.

## Commands

```bash
npm install
npm run dev         # Vite dev server
npm test            # vitest — the full correctness suite
npm run typecheck   # tsc for src/, AND tsconfig.scripts.json for scripts/ — both are required;
                     # `npx tsc --noEmit` alone silently skips scripts/
npm run build       # production build (GitHub Pages — see vite.config.ts's `base`)
npm run sim         # scripts/run-headless.ts — quick headless run printing population/gene means
npm run benchmark   # scripts/benchmark.ts — deterministic performance baseline, see SPEC.md
npm run regen-examples  # scripts/regen-examples.ts — rebuild public/scenarios/*.json against the
                         # current build's DEFAULT_PARAMS and verify each still demonstrates what
                         # it's named for; re-run after any change to core sim dynamics
```

## History retention

`taxonomyEvents` (speciation/extinction) are discrete facts and are never downsampled or dropped —
a species either split or it didn't, there's no lower-resolution version of that. Dense time-series
history (`populationHistory`, `traitHistory`) is different: on a very long run there are a lot of
samples, and old ones matter far less than recent ones. `src/sim/historyRetention.ts`'s
`compactHistory()` keeps full resolution for the most recent 10,000 ticks, every 5th sample for the
next 100,000 ticks back, and every 20th sample beyond that — run periodically (every 5,000 ticks,
not every tick) so a full pass over the array stays cheap and infrequent.
