# Evolution Simulator — Build Spec (v2)

Paste this into Claude Code as the initial prompt, or drop it in the repo root as `SPEC.md` and tell Claude Code to work through it phase by phase.

---

## What we're building

A browser-based, deterministic, agent-based evolution simulator. Digital organisms forage in a 2D world. Traits are heritable and mutate on reproduction. Over tens of thousands of ticks the population should **split on its own** into distinct lineages, and the app should render that history as a phylogenetic tree.

The primary deliverable is the tree. The world view exists to make the tree believable; the tree is the product.

## Non-goals

- No physics engine, no ragdolls, no limb/gait evolution.
- No neural networks in v1. Behavior is a small set of scalar genes driving a hand-written policy.
- No server, no database. Everything runs client-side.
- No 3D.

---

## Founding populations

`foundingPopulations` is a config parameter, not a constant. It takes:

- `count` — how many founding groups to seed (default **1**).
- Per-group: `size`, `startingGenome` (explicit values or `random`), `startPosition` (`random` | `clustered` | explicit coords).

Default to 1. Two founders with identical genomes is just one founder with more individuals. Two founders with *different* genomes is a legitimate experiment, but it answers a different question — competitive exclusion, "does the pre-adapted specialist beat the generalist" — not "can a population speciate on its own." Both are worth running; keep them separate in your head. The tree from a 2-founder run has two roots and a forest, not a tree, so the tree view must handle multiple roots.

---

## The tree is shaped by trade-off axes — read this before writing code

A phylogenetic tree only branches where the population faces a choice between two strategies that cannot be combined. Each such **trade-off axis**, if selection on it is disruptive, produces one binary split. One axis gives you two branches and then a flat line forever. That is a boring tree.

To get a bushy tree you need multiple *independent* axes, each with its own disruptive pressure. Three axes can in principle produce up to eight tips. This spec builds in three.

### Axis 1 — Diet (what you eat)

Gene: `dietPref` (0 = food type R, 1 = food type B).

Energy from eating food of type `f`:

```
gain = maxGain * (1 - abs(dietPref - f)) ^ specializationExponent
```

With `specializationExponent > 1`, a generalist at `dietPref = 0.5` does *worse* than the average of the two specialists. That penalty on the middle is what forces the split. Sweeping this slider from 0.8 to 3.0 should visibly turn a one-species run into a two-species run. That sweep is the money demo.

### Axis 2 — Foraging strategy (how you find it)

Genes: `speed`, `senseRadius`, `wanderPersistence`.

The trade-off only exists if the world has **two kinds of patch geometry**: a few large, rich, widely-separated patches and many small, poor, densely-scattered ones. Then:

- *Commuter* strategy: high `speed`, low `senseRadius`, high `wanderPersistence` — cover ground, travel between rich patches.
- *Camper* strategy: low `speed`, high `senseRadius`, low `wanderPersistence` — sit in a dense field of small patches and sweep locally.

Both are viable; the blend is worse than either, because paying for speed *and* sense at once starves you. Config knob: `patchBimodality` — 0 makes all patches identical (axis collapses), 1 makes the two patch classes maximally different.

### Axis 3 — Life history (how you reproduce)

Genes: `reproThreshold`, `offspringInvestment`.

`offspringInvestment` sets how much energy each child receives and how many children per split. Low investment = many cheap offspring that die easily; high investment = few well-provisioned offspring. This axis needs **temporal** structure to bite: make food regrowth oscillate with a configurable period and amplitude (`regrowthCyclePeriod`, `regrowthCycleAmplitude`). Cheap-and-many wins the boom, expensive-and-few survives the bust. Under a constant food supply this axis flattens and you get one strategy — that is the correct behavior and a useful control.

### Optional Axis 4 — Predation

Only after Phase 5 works. Add a `predatory` gene and let creatures eat each other; size becomes both weapon and target. Powerful for tree richness, but it destabilizes the population dynamics badly and can collapse a run to zero. Do not add this until the three-axis version runs reliably.

**The key implication:** if the tree comes out as a single split and then two flat lines, the problem is almost never the tree code. It is that only one axis has real disruptive pressure. Check `specializationExponent`, `patchBimodality`, and `regrowthCycleAmplitude` before touching the renderer.

---

## What the tree actually looks like

A concrete expected run at defaults, so you know what you're aiming at:

- **Tick 0–3,000.** One founding blob. `speed` and `senseRadius` settle toward whatever is metabolically efficient. No branch — this is directional selection, not disruptive. The tree is a single trunk.
- **Tick ~15,000.** `dietPref` goes bimodal. **First branch.** Trunk splits into `sp-1` (R-eater) and `sp-2` (B-eater).
- **Tick ~35,000.** Inside `sp-1`, the patch geometry splits it: `sp-3` commuters and `sp-4` campers. **Second branch,** on a different axis, at a different depth.
- **Tick ~55,000.** A food bust arrives. `sp-2` had drifted to cheap-and-many and crashes — its branch **terminates**. A survivor sublineage `sp-5` had higher `offspringInvestment` and continues.
- **Tick 80,000.** Four tips alive, one extinct branch, three internal nodes.

Each node in the rendered tree should be clickable and show a card: founding genome, peak population, lifespan in ticks, and which gene had the largest deviation from its parent species. That last field is what makes the tree *readable* — it labels each branch with the trait that caused it, which is exactly the thing you said you couldn't picture. A branch is not an abstraction; it is a sentence like "at tick 35,200 this lineage split because sense radius diverged by 2.4 sigma."

---

## Making interaction visible

Creatures in this design do not touch each other. They compete **indirectly**, by depleting shared food. That is real competition, but it is invisible unless you render it. Build these:

1. **World view** — creatures as dots colored by species, food as small squares colored by type. Click a creature to pin an inspector. This is the x/y map; it stays.
2. **Competition heatmap overlay** — a toggleable layer over the world showing, per grid cell, food consumed in the last N ticks, colored by which species ate it. Contested cells render as a blend. This is where you actually *see* two lineages fighting over the same patch, and where you see them stop fighting once they've specialized apart.
3. **Territory overlay** — per grid cell, the dominant species by creature-ticks spent there. Watch niches separate in space.

The competition heatmap is the one to build. It turns "they compete for food" from an assertion in the code into something on screen.

---

## Color encoding

Color carries two different jobs here, and one channel cannot do both. **Genotype** is continuous — it should drift smoothly and show convergence. **Species identity** is discrete — it should let you tell two lineages apart at a glance even when they've barely diverged. Encode them separately.

- **Fill = genotype.** A pure function of the genome. Two creatures with the same genes are the same color, always, regardless of ancestry.
- **Ring = species.** A 1–2px outline drawn in a categorical palette, assigned per `lineageId`, cycling through a fixed high-contrast set.

Provide a toggle for which reads dominant (thick ring / thin ring / ring off). Default to both on.

### The genotype mapping

Do **not** map three genes to raw R, G, B. sRGB is not perceptually uniform: the green channel dominates perceived lightness, blue variation is nearly invisible on small dots, and equal gene distance produces wildly unequal visual distance. A big divergence on the blue-mapped gene would look like nothing at all. RYB has the same problem plus a nonlinear conversion step and muddy browns wherever all three mix.

Use **OkLCh**, which is perceptually uniform. Convert to sRGB at draw time.

| Channel | Source | Rationale |
|---|---|---|
| **Hue** | `atan2(axis2Position, axis1Position)` — angle in the diet × foraging plane | Strategy *combination* becomes a hue angle. Circular and seamless, no wraparound artifact. |
| **Chroma** | normalized genetic distance from the founding ancestor centroid, clamped 0.02–0.20 | Directly implements "the more it diverges, the more it changes." The founding population renders near-gray; derived lineages get vivid. Divergence is legible across the whole map at a glance. |
| **Lightness** | third axis (life history), remapped into a narrow band, ~0.45–0.75 | Kept narrow so dots stay readable against terrain in both directions. |

Expose the channel assignments as dropdowns so any gene can be reassigned to any channel. Someone will want hue on life history eventually.

### Consequences to expect, not fix

Because fill is purely genotypic, two unrelated lineages that converge on the same strategy will render nearly identical despite being distant cousins. That is not a bug — it makes convergent evolution visible, which is one of the more interesting things this sim can show you. The species ring is what disambiguates them. Expect to be briefly confused by it the first time.

### Contrast constraints

- Render terrain **desaturated** — grayscale shaded relief with at most a faint tint. Creatures own the entire saturation budget of the frame. If terrain is colorful, the genotype encoding becomes unreadable, and terrain is background information.
- Every creature gets a thin dark outline underneath the species ring so light-lightness individuals don't vanish over pale ground.
- Food keeps a fixed, distinct visual language — small squares, fixed R/B colors — so it never competes with the creature hue scale.
- Offer a **deuteranopia-safe mode** that restricts hue to the blue↔orange arc instead of the full wheel. Red-green deficiency affects roughly 8% of men, and if diet maps to a red/green hue split, the primary axis is invisible to them.

### The legend is the gene-space scatter

Do not draw a separate legend widget. Color the gene-space scatter plot with the exact same function, and it becomes a live legend: every point sits at its own genome position wearing its own color, so the mapping explains itself and updates as the population moves. Label the axes and you're done.

### Use the same colors everywhere

Same fill function in the world view, the scatter, the Muller plot bands, and the phylogenetic tree branches. Cross-view color identity is what lets you look at a branch in the tree and immediately find those creatures on the map. Each tree node card shows its founding color as a swatch next to its current one — that pair *is* the visual record of how far that lineage has traveled.

---

## Terrain — promote this to a core system

Terrain is not decoration and not a god-mode toy. It is the **primary species-creation mechanism** in this app, and it should be built before the fine-tuning work in Phase 3.

There are three ways a lineage splits, and the app should support and distinguish all three:

- **Allopatric** — a physical barrier cuts the population in two, gene flow stops, the halves drift and adapt apart. Reliable, fast, easy to see, easy to cause on purpose.
- **Sympatric** — disruptive selection splits a population sharing one space (the three trade-off axes above). Real but finicky; needs well-tuned parameters and often just doesn't fire.
- **Founder effect** — a small group gets isolated and diverges mostly by drift, not selection. Very likely at populations of 100 or fewer.

The original spec leaned entirely on sympatric speciation, which is the hardest of the three. Adding terrain barriers means the app has a mechanism that works on demand.

### Terrain layer

A per-cell grid parallel to the food grid:

- `elevation` (0..1) — rendered as a shaded relief.
- `passability` (0..1), derived from elevation — movement cost multiplier. **Not a binary wall.** A ridge at passability 0.15 lets a trickle of migrants through; at 0.0 it's absolute. The partial-barrier case is the interesting one, because you get to watch a lineage split slowly with gene flow fighting divergence.
- `fertility` (0..1) — multiplies local food regrowth. Mountains are barren; valleys are rich. This makes terrain shape selection, not just block movement.

Terrain must be part of the serialized world state and part of the determinism hash.

## God-mode tools

Interactive brushes over the world view. Each one is an **event**, not a mutation of hidden state.

- **Raise / lower terrain** — brush with adjustable radius and strength. The headline tool.
- **Drop food** — place a patch of type R or B, with density and radius.
- **Drought / bloom** — scale regrowth in the brushed region.
- **Meteor** — instant kill of everything in a radius, plus a crater: elevation drop, fertility zeroed locally, then recovering over `craterRecoveryTicks`.
- **Seed founders** — drop N creatures with a chosen genome anywhere. Lets you run controlled invasion experiments.
- **Barrier stamp** — draw an impassable line directly, for clean allopatric experiments without sculpting.

### Interventions must be logged as replayable events

This is the requirement most likely to be skipped and it will cost you the whole project's reproducibility.

Every god action appends `{ tick, tool, params }` to an intervention log stored with the run. `runSimulation(seed, params, interventionLog)` must reproduce the run exactly, headlessly, with no user present. Without this, the first time you sculpt a mountain that produces a beautiful four-way radiation, that run is gone forever and cannot be re-examined, exported, or shown to anyone.

Corollary: the intervention log is also a saved "scenario." Ship two or three — a barrier-split scenario, a meteor-radiation scenario — as JSON files that load and play.

### On the meteor specifically

Its value is not spectacle. A mass extinction empties niches, and the survivors radiate into them — that is the single bushiest tree-producing event available. Strike, then watch a handful of survivor lineages fan out. Give the meteor a preview ring and an undo-to-last-checkpoint, because it's the one tool that can end a run you cared about.

## Tag every speciation event with its mechanism

Since the goal is understanding *how* species get created, each speciation event should record why, inferred from the state at that tick:

- `allopatric` — the two sub-clusters were spatially separated by a low-passability region at the time of divergence.
- `sympatric` — sub-clusters overlapped spatially; divergence tracked a trade-off axis.
- `founder` — the new lineage started from fewer than `founderCountThreshold` individuals and its divergence is spread across genes with no single dominant axis (drift signature).

Render the mechanism as branch color or icon in the tree, and let the tree be filtered by it. Also emit a plain-language event feed: "Tick 22,400 — allopatric split; population of 34 isolated west of the ridge; sense radius diverging." That feed, scrolling next to the map, is the thing that actually explains speciation to you.

### Gene-flow meter

One chart, and it's the instrument that makes the mechanism visible: **migration rate between defined regions over time**, and for the sexual-reproduction variant, cross-region breeding rate. Speciation *is* the moment that line goes to zero. Watching it decay after you raise a mountain is the clearest possible answer to "how are species created."

---

## Stack

- Vite + TypeScript, vanilla DOM for controls. No React in v1 — the sim loop must not be tied to a render framework.
- Rendering: Canvas 2D. One canvas for the world, separate canvases for charts.
- Zero runtime dependencies. If a chart genuinely needs a library, use `uPlot`; do not pull in D3 or Chart.js.
- The simulation core must be a **pure, headless TypeScript module** with no DOM or canvas imports, runnable from Node for tests and batch runs.
- Vitest for tests.

## Architecture

```
src/
  sim/
    rng.ts          # seeded PRNG
    genome.ts       # gene definitions, mutation
    world.ts        # patches, food spawning, regrowth cycles
    creature.ts     # sensing, movement, metabolism, reproduction
    sim.ts          # tick()
    taxonomy.ts     # lineage tracking + species assignment
    recorder.ts     # time-series + speciation event log + consumption grid
  render/
    worldView.ts
    overlays.ts     # competition heatmap, territory
    treeView.ts
    mullerView.ts
    scatterView.ts
  ui/
    controls.ts
    params.ts       # ALL tunables in one place
  worker/
    sim.worker.ts
  main.ts
```

### Hard requirements

1. **Determinism.** One seeded PRNG (xorshift128+ or PCG32) passed explicitly into the sim. `Math.random()` is banned in `src/sim/`. Same seed + same params ⇒ identical state at tick N. Write a test asserting this.
2. **Fixed timestep.** Integer ticks. Nothing in the sim reads wall-clock time or `requestAnimationFrame`.
3. **Sim rate decoupled from render rate.** The UI runs N ticks per frame; fast-forward changes N, never the mechanics.
4. **All tunable constants live in `params.ts`** and every one is exposed in the UI.

---

## Full genome

| Gene | Range | Axis | Effect |
|---|---|---|---|
| `dietPref` | 0..1 | 1 | Which food type yields energy |
| `speed` | 0.2..3.0 | 2 | Distance per tick; cost scales with speed² |
| `senseRadius` | 0..20 | 2 | Food detection range; linear cost |
| `wanderPersistence` | 0..1 | 2 | Heading inertia when nothing is sensed |
| `size` | 0.5..2.0 | — | Energy capacity; scales all costs |
| `reproThreshold` | 0.4..0.95 | 3 | Energy fraction at which it reproduces |
| `offspringInvestment` | 0..1 | 3 | Energy per child vs number of children |
| `mutationRate` | 0.001..0.2 | meta | Per-gene mutation sigma for its offspring — evolvable, deliberately |

Metabolic cost per tick:

```
cost = baseCost * size
     + moveCost * speed^2 * size
     + senseCost * senseRadius
```

Tune coefficients so a mid-range creature roughly breaks even at moderate food density. The sim is uninteresting if any trait is free or unaffordable.

## Behavior policy (v1, no neural net)

Per tick: scan within `senseRadius`; if food found, steer toward the best `expectedGain / (distance + 1)`; else wander with heading blended by `wanderPersistence`; move, pay cost, eat on overlap; reproduce if over threshold; die at zero energy or past `maxAge`.

Creatures deliberately do **not** move purely randomly. Pure random walk gives selection nothing to grip except metabolic cost, so every behavioral gene drifts to noise and the tree never branches. Sensing is what makes `senseRadius`, `speed`, and `dietPref` pay off. The randomness you want is still there — it lives in mutation and in wandering when nothing is in range.

## World

- Continuous 2D toroidal plane. Uniform spatial hash grid for neighbor queries — never O(n²).
- Two food types, R and B.
- Patches, not uniform scatter. Two patch classes controlled by `patchBimodality` (see Axis 2). Patch type-mix controlled by mode: `patchy` (R clusters and B clusters at fixed centers) or `gradient` (R/B probability varies with x).
- Regrowth capped at carrying capacity, oscillating per `regrowthCyclePeriod` / `regrowthCycleAmplitude` (see Axis 3).

---

## Taxonomy — how the tree gets built

Every creature has a `lineageId`; every birth records `(parentId, childId, tick)`. The individual-level graph is a true tree with millions of nodes — **never try to render it.** Instead:

- Each species keeps a running centroid of its members' genomes.
- On each birth, compute the child's normalized distance to its species centroid across weighted genes. Weight the axis-defining genes heavily; drift in `size` shouldn't found a species.
- If distance > `speciationThreshold` **and** at least `minFounders` recent births cluster in the same region of gene-space, declare a new species: fresh `lineageId`, record `{ parentSpecies, tick, foundingCentroid, dominantDivergentGene }`.
- Record extinction ticks too.

That event log is the entire input to the tree view. It's small; make it exportable as JSON.

**Species here is a threshold you chose, not a fact.** In an asexual sim there is no natural species boundary — you are drawing lines through a continuous cloud, and the tree is partly a picture of `speciationThreshold`. Consequences: make the threshold live-adjustable, and make species reassignment re-runnable from recorded genome samples *without* re-running the sim, so you can see how the tree changes as you move the line. If the tree's topology is unstable under small threshold changes, the branches aren't real.

### Optional: make species real (v1.5)

Switch reproduction from asexual splitting to sexual, with mate choice gated on genetic distance: a creature will only breed with a partner within `matingDistance` in gene-space. Assortative mating turns reproductive isolation into an *emergent* property, and then a branch means something biologically defensible instead of being a clustering artifact.

Cost: you need mate-finding (nontrivial at low density), diploid or averaged genomes, and careful tuning — too tight a `matingDistance` and reproduction stalls to extinction. Worth doing, but only after the asexual version produces a stable tree.

---

## Views

1. World view + competition heatmap + territory overlay (above).
2. **Phylogenetic tree** — species-level, multi-root capable. Time on x, species as horizontal lines branching at speciation ticks, terminating at extinction. Branch labeled with `dominantDivergentGene`. Click a branch to filter every other view to that lineage.
3. **Muller plot** — stacked area of relative species abundance over time. Most legible view of a takeover or split; prioritize it.
4. **Gene-space scatter** — selectable gene on each axis, one point per living creature, colored by species. Watch one blob become two. This is where speciation is visible *as it happens*.
5. **Trait time-series** — population mean ± std per gene.
6. **Gene-flow meter** — migration rate between user-defined regions over time. The instrument for watching isolation happen.
7. **Event feed** — scrolling plain-language log of speciations, extinctions, and interventions, timestamped by tick and clickable to jump the tree and map to that moment.

## Controls

- Play / pause / step-one-tick.
- Speed 1×, 10×, 100×, 1000×, max.
- Seed input + restart-with-seed.
- Every `params.ts` value as a labeled input, with live vs deferred toggle. Mid-run intervention is a feature: halve food regrowth at tick 50k and watch which branch survives.
- Save/load run config as JSON; export time-series and speciation log as JSON.

## Performance

- Sim runs in a **Web Worker**; post compact snapshots via transferable `Float32Array` containing only render-relevant fields. Do not structured-clone the creature array every frame.
- Move to struct-of-arrays typed storage once the naive version works — not before.
- Target 500–1,000 creatures at 1,000+ ticks/sec. The design intent is a legible map of tens to hundreds of visible icons, not a swarm — so this is comfortably achievable on the main thread. **Defer the worker and typed arrays until profiling says you need them.** Small populations also mean drift is strong and speciation happens fast in wall-clock terms, which is what you want for watching.

**Baseline** (run `npm run benchmark`; deterministic, fixed seed — numbers are comparable across
runs but will shift with hardware). This was still comfortably meeting target at the point profiling
was last checked, well before the point a worker/typed-arrays would need to be seriously considered:

| founding population | ticks/sec | updateTaxonomy ms/call | decayConsumption ms/call |
|---|---|---|---|
| 100 | ~2,300 | ~0.43 | ~0.004 |
| 500 | ~1,900 | ~0.57 | ~0.002 |
| 1,000 | ~1,400 | ~0.66 | ~0.002 |
| 5,000 | ~440 | ~1.3 | ~0.002 |

500–1,000 (the actual design target) clears the 1,000+ ticks/sec bar; 5,000 (well beyond the
intended "legible map" scale) does not, which is expected and not a regression — nobody is meant
to run that large. `updateTaxonomy` scales roughly with population as expected (a near-linear pass
per species); `decayConsumption`'s cost is dominated by tracked-species count, not population, and
stays flat since it's already batched (see sim/consumption.ts) rather than run every tick. ~52 MB
heap after a 20,000-tick run at founding=1,000 — bounded, not growing without limit (see
sim/historyRetention.ts for why observation history specifically doesn't grow forever).

---

## Build order

Each phase runs and is committed before the next.

1. **Phase 1** — Headless sim: RNG, patched world, terrain grid, creatures, metabolism, reproduction, death. Node script running 10,000 ticks printing population and mean genes every 500. Determinism test passing.
2. **Phase 2** — Canvas world view with shaded terrain, play/pause/speed, creature inspector.
3. **Phase 3** — God-mode brushes + intervention event log + replay. Verify that a logged run replays headlessly to an identical hash. Doing this early means every later experiment is reproducible; doing it late means re-instrumenting everything.
4. **Phase 4** — Taxonomy, species assignment, mechanism tagging, event feed, gene-flow meter. **Milestone: raise a barrier by hand and watch an allopatric split get detected and logged.** This is the first end-to-end proof the app does what it's for, and it does not depend on any delicate tuning.
5. **Phase 5** — Phylogenetic tree view with branch labels, mechanism coloring, lineage filtering. Muller plot.
6. **Phase 6** — Recorder charts, gene-space scatter, competition heatmap, and **now** the sympatric tuning: get each of the three trade-off axes to independently produce bimodality with no barrier present. Verify one axis at a time by flattening the other two. This is the hardest and least predictable work, which is exactly why it is no longer blocking everything else.
7. **Phase 7** — Full parameter UI, scenario save/load, JSON export. Worker and typed arrays only if profiling demands them.
8. **Phase 8 (optional)** — Sexual reproduction with assortative mating; predation axis.

## Testing

- **Determinism:** same seed, 5,000 ticks, hashed state identical across runs.
- **Energy conservation:** food consumed in = metabolism + death losses out. No leaks.
- **Zero-mutation control:** `mutationRate` forced to 0 ⇒ gene means must not drift.
- **Neutral control:** `specializationExponent = 0`, `patchBimodality = 0`, `regrowthCycleAmplitude = 0` ⇒ assert no bimodality and no speciation events. If you detect species in a run with no disruptive pressure, the detector is finding noise and every result after that is meaningless.
- **Single-axis isolation:** three runs, each with exactly one axis active, each asserting bimodality on that axis and only that axis.

---

## Addendum — post-Phase 2 direction check

Feedback after Phase 1/2 landed confirmed the core interaction model (click a creature, see its
species/stats — StarCraft-style unit inspection) is right, and surfaced two deliberate deviations
from a strict reading of the phases above. Recorded here so the intent survives past the chat that
produced it.

### Visual style: parchment map, not a dashboard
The long-term look is a fantasy map in the LOTR sense — black-and-white / sepia, ink-on-parchment
terrain — with a StarCraft-minimap-style overlay for creatures and resources, rather than the flat
dark-UI dashboard Phase 2 shipped with. This is a *reskin*, not a contradiction of the color-encoding
rules above: terrain is already required to be desaturated so creatures own the saturation budget,
and a parchment/ink treatment satisfies that constraint at least as well as flat gray cells do. The
OkLCh genotype-color math and the species-ring/inspector model stay as designed; only the terrain
rendering and UI chrome are in scope for the reskin. **Sequencing: after Phase 3**, once god-mode
terrain tools give the map something worth re-styling around, rather than reskinning a screen that's
about to gain new elements anyway.

### New mechanic: ongoing parental care ("nursing")
Currently reproduction is a single instant transaction: a lump of energy is handed to the child at
birth (`offspringInvestment`, `offspringEnergyFraction{Min,Max}`), and the parent/child relationship
ends there. The requested addition is real, sustained parental care: a parent continues spending its
own energy on a specific, still-immature offspring for some evolvable duration before that offspring
matures and becomes independent. This is genuine r/K selection theory — the tradeoff between many
cheap, fast-maturing offspring (favored by scarcity, competition, instability) and few offspring with
heavy sustained investment (favored by abundance and stability) — and the specific question driving
it is whether resource abundance/competition level in a region evolves the local population toward
one strategy or the other.

This is a core-sim change, not a UI feature: it needs an evolvable duration gene, an ongoing
parent→child energy transfer each tick (not just at birth), tracking of which offspring are still
dependent, and a decision for what happens to a dependent offspring if its parent dies mid-nursing
(likely: it dies too, or matures early and independent — needs a decision when this is designed).
**Sequencing: fold into Phase 6**, which is already where the spec schedules deep tuning of the
life-history axis (`reproThreshold`/`offspringInvestment`) — extending that axis to model ongoing
care fits there naturally, after terrain barriers (Phase 3) and taxonomy/speciation detection
(Phase 4) exist to actually observe the effect on divergence.

---

## Addendum 2 — food density fix, and two more direction checks

After the visual-style/nursing discussion above, the live app surfaced a real bug: food looked like
it covered nearly every cell (fixed — see git history around "Make food genuinely sparse"; the short
version is drawFood was sizing squares by *local* fill fraction instead of *true abundance*, and an
ambient floor plus an untruncated Gaussian falloff meant almost every cell had some nonzero food).

One useful side effect of that fix, worth recording: once patches had real gaps between them, the
population visibly clustered into distinct, differently-colored groups around separate patches —
using only the sensing/foraging behavior that already existed. No new mechanic was needed for
*resource-driven* clustering.

That prompted two more feature requests, both deliberately deferred:

- **Predation ("hunting")** — this is Optional Axis 4, already in the spec above with an explicit
  warning not to add it before Phase 5. Confirmed: stays deferred, no change to the plan.
- **"Homing" gene (kin-based site fidelity)** — distinct from the resource-driven clustering above:
  the idea is offspring staying near their birthplace/each other *independent* of current food
  location, which is what would let "does site fidelity correlate with parenting strategy" (tying
  into the nursing mechanic) be asked cleanly. **Decision: hold off for now** — see how far
  resource-driven clustering alone goes once Phase 3/4 land before deciding whether this still adds
  something new. Revisit then; don't design it preemptively.

---

## Addendum 3 — Phase 6 axis-isolation findings

Per-axis isolation runs (see `scripts/explore-axis.ts`, `src/sim/axisIsolation.test.ts`) confirmed
the neutral control (all three axes flat) never false-positives, and diet/foraging both produce a
genuine detected speciation event when run in isolation for long enough — diet needs ~18,000 ticks
of drift under `specializationExponent: 3` before the split clears both the gap-detection and
aggregate-distance thresholds (close to this doc's own worked-example estimate of "~15,000"),
foraging is faster and more reliable under `patchBimodality: 1.0` (first split by ~19,000 ticks,
second by ~20,000).

Life history behaved differently, and it's a real finding rather than a tuning miss: run in
isolation (spatially uniform population, no diet/foraging structure), `regrowthCycleAmplitude` at
any tested amplitude/period never produced bimodal `reproThreshold`/`offspringInvestment` — instead
it produced large, cycle-synchronized population swings (3-10x peak-to-trough) with the whole
population's mean trait dragged back and forth each half-cycle. This makes sense mechanistically: a
synchronized *global* cycle applies identical selective pressure to every individual at once, so
there's no spatial refuge for a "losing" strategy to persist in — unlike diet/foraging, which are
disruptive (frequency- or space-dependent) by construction. The doc's own worked example (the
tick-~55,000 bust) has the life-history branch arrive as a *second*, asymmetric split inside an
already-diverged lineage, not as a standalone founder-population split — i.e. it's meant to prune
within existing spatial structure the other two axes provide, not create bimodal structure alone.
`axisIsolation.test.ts` tests this axis accordingly: population-size-swing amplitude vs. a flat
control, and confirms no spurious species split is reported for what is genuinely directional (not
disruptive) selection.
