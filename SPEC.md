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

---

## Addendum 4 — the nursing ("ongoing parental care") mechanic

Implements the mechanic scoped into Phase 6 back in Addendum 1: real sustained parental care, not
just the one-time birth endowment `offspringInvestment` already controlled, so the r/K
selection question ("does resource abundance favor slow-maturation/heavy-investment vs.
fast/cheap/many") has an axis that can actually answer it.

**Design, as built:**

- New gene `nursingDuration` (range 0-600 ticks) — how long a parent keeps actively feeding a
  given child after birth, on top of that child's one-time birth energy. 0 is a fully valid value
  (no ongoing care), matching every scenario that predates this gene.
- A parent's *own* `nursingDuration` gene decides how long it nurses *each* of its children —
  set once, at birth, as `child.nursingUntilTick = birthTick + parent.genome.nursingDuration`
  (`creature.ts`'s `reproduce()`). The child's own `nursingDuration` gene only matters later, once
  *it* becomes a parent.
- Each tick, every still-dependent child (`nursingUntilTick` not yet reached) receives a fixed
  `nursingRatePerTick` (a biological constant, not itself evolvable — `nursingDuration` is the
  evolvable "how long" axis) transferred from its parent, capped by the parent's available energy
  (`sim/nursing.ts`). This is a genuine zero-sum cost to the parent, not free energy.
- `nursingDuration` also folds into the life-history color axis (`render/color.ts`'s
  `lifeHistoryAxisPosition`) alongside `reproThreshold`/`offspringInvestment`, and into taxonomy's
  genetic-distance metric at a deliberately low weight (0.1, matching `mutationRate`) — a full
  weight comparable to the other life-history genes measurably diluted the taxonomy detector's
  already-tuned sensitivity (see below).

**Decision: what happens if the parent dies mid-nursing?** The child simply stops receiving care
and continues on its own — it does not die with the parent. A hard "dependent dies too" rule would
stack a second, harsher death mechanic on top of ordinary starvation, and losing a parent's subsidy
early is already a real cost (a lost energy stream) without needing to also be a death sentence.

**A real tuning cost, worth recording:** adding a 9th gene to a taxonomy detector calibrated
around 8 diluted every other gene's relative contribution to genetic distance enough to break the
Phase 4 milestone test and both the diet and foraging axis-isolation tests (see their calibration
history above) — fixed by the low weight noted above, plus a gentler `nursingRatePerTick` (0.004,
down from an initial 0.015 that was enough of an energy-economy shock on its own to shift
population dynamics) and, for the axis-isolation tests specifically, explicitly flattening
`nursingRatePerTick: 0` in their shared `NEUTRAL` baseline — a true single-axis isolation test
needs every *other* mechanism flattened, and nursing is very much another mechanism relative to
whichever axis is under test.

## Addendum 5 — Milestone 2 design note: SpeciesProfile + CapabilityClassifier

This is a **design note, written before implementation**, per the game roadmap's own process
(Milestone 1's exit gate passed 2026-08-12 — graphics flagged as wanting but not blocking, deferred
to Milestone 7 — and Dan greenlit starting Milestone 2). It documents the plan Dan signed off on so
implementation can be checked against it afterward, the same way Addenda 1-4 record decisions before
or alongside the code that implements them.

**The core rule this milestone exists to enforce: Genome != Capability.** Today a `Species` (
`sim/taxonomy.ts`) carries exactly one behavioral aggregate — `centroid`, a running mean of its
living members' *genomes*. Milestone 1's objectives (`game/objectives/standardObjectives.ts`) used
`centroid.dietPref` as a diet-specialization stand-in, with an explicit code comment deferring real
calorie-share tracking to this milestone. A `CapabilityClassifier` must describe *demonstrated
ecological behavior* — what a species actually eats, where it actually lives, how far it actually
moves — not a re-labeling of its genes. A species whose `dietPref` gene sits at 0.5 but that has, in
practice, only ever found food type R growing near it is a dietary specialist in every way that
matters to the player, and the classifier needs to say so.

**Why most of this needs new `sim/` instrumentation, not just `game/`-layer aggregation:** the
`Creature` type (`sim/creature.ts`) retains no history — position, energy, and age are overwritten
every tick, nothing about *what happened* survives past the tick it happened in. The one exception
is `ConsumptionGrid` (`sim/consumption.ts`, built for Phase 6's competition heatmap), which already
tracks per-species cumulative food consumed per cell, decayed every `consumptionDecayIntervalTicks`
— but it sums food types R and B together, so it can't answer a diet-*composition* question, only a
diet-*volume* one.

**SpeciesProfile — one running aggregate object per species, not a time series.** Modeled on how
`centroid` itself already works: continuously updated in place at the existing taxonomy pass
(`updateTaxonomy`, every `taxonomyIntervalTicks`, default 100), decayed the same way
`ConsumptionGrid` decays, so the profile reflects a species' *recent* demonstrated behavior and can
visibly shift if a species' realized ecology changes after a split — rather than an ever-growing
history (that's what `populationHistory`/`traitHistory` are already for, and `historyRetention.ts`'s
generic `compactHistory<T>` remains the tool of choice if a bounded history is ever needed here).

All five dimensions, approved for a single first pass rather than a narrower slice:

| Dimension | New `sim/` instrumentation | What it measures |
|---|---|---|
| Diet | Split `recordConsumption` into separate R/B running totals per species (same cadence/decay as today's combined total) | realized food-type share, replacing the `dietPref` genotype proxy |
| Habitat | None — sample each live creature's terrain elevation band (lowland/hill/mountain, the bands `render/terrainPalette.ts` already defines) during `updateTaxonomy`'s existing per-species iteration | terrain-band occupancy histogram |
| Movement | Add a `distanceTraveled` accumulator to `Creature`, incremented in `stepCreature`'s move step | realized movement per tick vs. population baseline, not the `speed` gene |
| Reproduction | Tally births and deaths (+ sum of age-at-death) per species per sampling window, incremented at creature creation/removal | births-per-capita, average realized lifespan — the observable half of the r/K question the nursing mechanic (Addendum 4) exists to let evolve |
| Survival | None — already available | reuses `populationHistory` volatility/recovery, the same logic `standardObjectives.ts`'s disaster-recovery objective already computes |

All four new counters are pure, deterministic tallies keyed off existing tick/event points — no new
randomness, no new genes, no change to any existing gene's meaning or weight. This keeps them within
the rigor bar the roadmap's team model sets for anything touching the core tick loop, and mirrors
`consumption.ts`'s existing pattern closely enough that it's an extension of a precedent, not a new
one.

**CapabilityClassifier** reads a `SpeciesProfile` and emits labels, each with a confidence (scaled
by the species' `memberCount` — small populations yield low-confidence labels, matching how a real
field biologist would hedge on a thin sample) and evidence (the specific aggregate values that
produced the label, for a UI tooltip). Initial label set, one pair per dimension above: Dietary
Generalist / Specialist(R) / Specialist(B); Highland-Adapted / Lowland-Adapted; Fast-mover /
Sedentary; r-strategist / K-strategist; Resilient / Fragile. This set is expected to grow — nothing
about the classifier's shape is specific to these five pairs — but it is not meant to anticipate
Milestone 6's amphibious speciation or Milestone 9's flight; those get their own labels once the
underlying phenotype/performance layers (Milestones 3-5) that would make them meaningful actually
exist.

**Where the code lives:** `SpeciesProfile` and `CapabilityClassifier` themselves belong in
`src/game/` (a new `observability/` subdirectory, alongside the existing `objectives/`) — they only
need read access to sim-exposed types (`Species`, the extended `ConsumptionGrid`, `populationHistory`
), matching `objective.ts`'s own existing comment anticipating a "future SpeciesProfile/capability
layer" objectives would eventually read from. Only the four new counters themselves are `sim/`
changes, since they must be written from inside the tick loop; everything that aggregates or
classifies from them stays on the `game/` side of the boundary, so `sim/` still never imports from
`game/`.

## Addendum 6 — food system redesign, part A: persistent fruit trees replace the R/B grid

Design note, written before implementation, same process as Addendum 5. Motivation (Dan, after
playtesting M2): reduce two food types the player has to spread around down to one, and set up
predation as a real population-control mechanism (part B, sequenced separately — deliberately, "one
system at a time" the same way every other milestone here has been). This addendum is part A only:
fruit trees. Predation/meat is its own follow-up addendum once this lands and plays well.

**This removes Axis 1 (diet) entirely, for as long as part A stands alone.** With only one food
type, `dietPref` has nothing left to trade off against — the gene, `gainPerUnit`'s specialization
curve, its `GENE_WEIGHTS` entry, the diet axis-isolation calibration, `standardObjectives.ts`'s
`createDietarySpecialistObjective`/`createDietaryGeneralistObjective` (and the "Picky Eaters"
challenge built entirely on the specialist one), and M2's `SpeciesProfile.diet`/dietary capability
labels are all removed in part A, not left around half-working. Dan chose "trees first, then
predation" knowing this gap exists; part B reinstates a diet axis reshaped around fruit vs. meat
preference, on the genes that are actually meaningful again at that point.

**Tree lifecycle**, per Dan's own description: a tree is planted (sapling), takes
`treeMaturityTicks` to mature, then produces fruit; each tick a mature tree has a chance to die,
scaled by local crowdedness (nearby tree density — self-thinning, a real forest-ecology effect);
eating a tree's fruit has a small chance (`saplingChance`) of planting a new sapling nearby
(`saplingSpreadRadius`) — seed dispersal via feeding.

**Architecture:**
- `World.fruit: Float64Array` replaces `r`/`b`/`capacityR`/`capacityB` — one dense per-cell channel,
  so `creature.ts`'s hot per-tick sense/eat loop stays close to its current shape (one array instead
  of two, no `rGain`/`bGain` branch — intake is just `min(world.fruit[idx], intakeRate)`, always
  eaten, no specialization curve since there's nothing to specialize between).
- New `sim/trees.ts`: `FruitTree { id, x, y, plantedTick, maturedTick: number | null }` (an array,
  parallel in spirit to `Creature[]`) + `stepTrees(trees, world, terrain, rng, params, tick)` —
  advances maturity, regrows each mature tree's fruit into its own `world.fruit` cell (replacing
  today's uniform `regrowFood`) up to a per-tree capacity, and applies crowdedness-scaled death.
  `trySeedSapling(trees, x, y, rng, params, allocateId, tick)` is called from creature.ts's eat step.
- Crowdedness death is the one real performance risk (naive all-pairs distance is O(trees²) every
  tick) — bucket trees by the existing `gridCellSize` grid (same spatial resolution `World`/
  `TerrainGrid` already use) so a neighbor count is a small local scan, not a full pass, and only
  run the death check on a coarser cadence (a new `treeCrowdingCheckIntervalTicks`, same pattern as
  `consumptionDecayIntervalTicks`) rather than every tick for every tree.
- **Correction, caught during implementation:** an earlier draft of this addendum had world
  generation seed one uniform population of trees. That silently collapses Axis 2 (foraging
  strategy) too — its commuter-vs-camper trade-off needs "a few large, rich, widely-separated
  patches and many small, poor, densely scattered ones" (SPEC.md's own Axis 2 section), which was
  never actually about the R/B food-TYPE split, just food-patch geometry that happened to live in
  the same generation code. World generation now seeds two groups —`richTreeCount` (few,
  full-capacity, individually placed) and `poorTreeCount` (more numerous, capacity scaled down by
  `patchBimodality`) — both via independent uniform-random placement rather than explicit spatial
  clustering, specifically so `patchBimodality=0` makes the two groups genuinely statistically
  indistinguishable (same capacity, same placement distribution) for the neutral-control
  axis-isolation test. `foodMode: "gradient"` (the other existing generation mode) has no obvious
  tree analog and is dropped along with `FoodMode` — flag this to Dan if he was relying on it, but
  nothing in the current UI/scenarios exposes switching it.
- New `TreeParams` params group replaces the food-patch fields of `WorldParams`
  (`richPatchCount/Radius/Capacity`, `poorPatchCount/Radius/Capacity`, `baseCapacity`,
  `ambientFoodFraction`, `foodMode`): `richTreeCount`, `poorTreeCount`, `patchBimodality` (kept,
  same meaning as before), `treeMaturityTicks`, `treeFruitCapacity`, `treeFruitRegrowthRate`,
  `saplingChance`, `saplingSpreadRadius`, `crowdingRadius`, `baseDeathChancePerCheck`,
  `crowdingDeathMultiplier`,
  `treeCrowdingCheckIntervalTicks`.
- God-mode: "Drop food R"/"Drop food B" brushes collapse into one "Plant tree" brush
  (`intervention.ts`'s `DropFoodParams` loses `foodType`).
- Determinism unchanged in kind: tree lifecycle (which sapling attempts succeed, which mature trees
  die) is driven by the same shared `RNG` everything else uses.

**Predation groundwork, documented now per Dan's request but NOT implemented until part B:** a
predation attempt's success will start as odds weighted by the predator's and prey's relative size
and speed — no new gene needed initially, reusing genes that already exist. But Dan wants room to
later split this into dedicated `attackPower` and `escapePower` genes that only *correlate* with
size/speed rather than being identical to them (e.g. a small creature could evolve low attack but
very high escape). So the combat resolution function should be written now, when part B starts,
against named seams — `effectiveAttackPower(genome)` / `effectiveEvasionPower(genome)` — that are
thin wrappers over size/speed at first, so swapping their internals for real genes later doesn't
touch any call site. Outcomes: kill, or escape (prey evades, no kill) — a third "outsmarting"
dimension was floated and explicitly deferred, per Dan: "introduces more dimensions I'm not ready to
deal with." Also worth carrying into part B's own design note: the original SPEC.md already warned
predation "destabilizes population dynamics badly and can collapse a run to zero" (Optional Axis 4) —
part B's design should address that directly, not discover it by watching a run collapse.

**Implementation status (2026-08-12): built, real bugs found and fixed, one known gap left open
deliberately rather than declared fixed.** Three real bugs surfaced during implementation, not
just design refinements:
1. Uncapped sapling growth trivially outpaced death pressure, growing the tree population without
   bound and blowing a 5,000-tick determinism test's runtime from seconds to a 60s+ timeout. Fixed
   with a hard `maxTreeCount` cap — the actual population-control backstop; crowding death is
   flavor on top of it, not a substitute.
2. `stepTrees` regrew every tree toward one shared `treeFruitCapacity` ceiling regardless of
   whether it was planted rich or poor, silently erasing the bimodal capacity split after the
   first regrowth tick. Fixed by giving `FruitTree` its own `capacity` field.
3. Poor-tree cluster placement sampled a uniform *distance* with a uniform *angle*, which is
   inherently radially peaked at the cluster center no matter how large the radius — so scaling
   radius toward "collapsed" at `patchBimodality=0` never actually converged to uniform placement,
   and the neutral-control test started detecting phantom speciation events. Fixed by making
   `patchBimodality` a per-tree mixing *probability* (clustered vs. a fresh independent uniform
   draw) instead of a continuously-scaled radius — this collapses exactly at 0, not asymptotically.

**Gap since resolved (2026-08-12, same day as Addendum 7's predation work) — recorded here for
history, not left open.** Point-source trees are a genuinely weaker disruptive-selection geometry
for Axis 2 (foraging) than the old Gaussian patches were — a single tree, however "rich," has no
footprint the way a patch spanning dozens of cells did. `axisIsolation.test.ts`'s "foraging axis in
isolation" (and two golden scenarios depending on the same mechanism) didn't reliably reproduce a
clean split within reasonable ticks under the *isolated* single-axis test conditions, even after
real tuning attempts scoped to this addendum alone (richTreeCount swept 40→8→4, rich/poor capacity
contrast sharpened, cluster tightness increased). What actually fixed it turned out to live outside
this addendum entirely: Addendum 7's `attackCooldownTicks` fix (built for predation population
stability, an unrelated bug) also stabilized population dynamics broadly enough for this axis's
comparatively weak signal to reliably surface again. All three tests un-skipped and passing; a
third golden scenario ("extinction and radiation") needed its own fix on top — seed 42 never
speciated at all under the new geometry even by tick 12,000 (confirmed directly), so it was
switched to seed 1 (reliably speciates by ~tick 6,000) with the meteor moved from tick 3,000 to
7,000, giving the split time to establish before the meteor needs a regional lineage to wipe out.

## Addendum 7 — food redesign part B: predation and meat

Design note, written before implementation, same process as Addenda 5 and 6. Sequenced after part
A per Dan's own explicit choice ("one system at a time"). Two decisions confirmed with Dan before
writing this: **cannibalism is allowed** (a creature can attack another of its own species — opens
the real possibility of one ancestral population splitting into predator and prey sub-lineages of
itself, which is more interesting than it is dangerous); and **no artificial population-collapse
safeguard** — the original SPEC.md's own warning that predation "destabilizes population dynamics
badly and can collapse a run to zero" is accepted as a real, expected risk to tune against via
playtesting, not something to mechanically prevent up front. Population control via predation was
literally Dan's stated motivation for this whole food redesign.

**Reinstates Axis 1 (diet), reshaped around fruit vs. meat instead of R vs. B.** New gene
`carnivory` (0 = pure herbivore, 1 = pure carnivore), same weight (1.0) and the exact same
specialization-curve shape `gainPerUnit` had before part A removed it —
`gain = maxGain * (1 - abs(carnivory - foodType))^specializationExponent`, foodType 0 = fruit, 1 =
meat — just with new labels. `specializationExponent` is reintroduced; `maxGain` is what part A's
`fruitGainPerUnit` reverts to being called, now the shared ceiling both curves reference.

**Sensing and targeting extend the existing mechanism, not a parallel one.** `senseFood` already
picks between food sources by comparing `amount * gain / (dist + 1)` scores (that's how R vs. B
competed before, and how fruit alone works now) — prey becomes a third candidate in the same
comparison, scored `preyEnergy * meatGain(carnivory) / (dist + 1)`. A herbivore's `meatGain` is
near zero, so it naturally never finds attacking prey worthwhile — no explicit
"carnivory > threshold" gate needed, the existing scoring mechanism already produces that behavior
for free, the same way it already made R-specialists ignore B food without a gate.

**Combat resolution — the seam Dan specifically asked for.** `effectiveAttackPower(genome) =
genome.size`, `effectiveEvasionPower(genome) = genome.speed`: thin wrapper functions, not inlined
math, so a later `attackPower`/`escapePower` gene pair can replace their internals without
touching any call site. Success probability is a standard contest-success function,
`attackPower / (attackPower + evasionPower)` — bounded (0, 1), and since every gene's range keeps
size and speed strictly positive, never exactly 0 or 1. Two outcomes only: kill (prey removed,
predator gains the prey's energy-at-death scaled by the predator's own `meatGain(carnivory)`) or
escape (no kill, no extra cost beyond the metabolism both sides already paid this tick) — a third
"outsmarting" dimension was floated and explicitly deferred back in Addendum 6's groundwork notes,
per Dan: "introduces more dimensions I'm not ready to deal with."

**Architecture — attempts are recorded during the existing per-creature pass, resolved in a
separate pass after.** Resolving a kill synchronously mid-loop (directly zeroing a not-yet-visited
prey's energy) would need every other piece of per-tick logic — reproduction eligibility, the
survival check that builds `nextGeneration` — to defensively re-check "am I already dead" in ways
they don't today, and a creature already pushed into `nextGeneration` earlier in the loop wouldn't
get removed by a later kill without an explicit final filter anyway. Cleaner: `stepCreature`
records a `{predatorId, preyId}` attempt (if it ends its move within `attackRange` of a valid prey
target) into a list, unchanged otherwise; a new `resolvePredation` pass runs after
`nextGeneration` is finalized, rolling each attempt in order and removing/crediting energy — a
second attempt whose prey a first attempt already killed this tick is a genuine no-op, re-checked
at resolution time, not just queue time. Prey-sensing needs a spatial index of creatures (bucketed
by grid cell, same pattern `trees.ts`'s crowding-neighbor lookup already uses) built once per tick
before the main loop — O(n) instead of an O(n²) all-pairs scan against a population that can run
into the thousands.

**Deliberately out of scope for this pass, flagged as natural follow-ups, not forgotten:** M2's
`SpeciesProfile`/`CapabilityClassifier` diet dimension and `standardObjectives.ts`'s dietary
objectives (removed in Addendum 6) are not being reinstated here — Dan asked for the core mechanic,
not the observability layer on top of it. Revisit once the mechanic itself has been played with.

**Implementation status (2026-08-12): built, one real bug found and fixed, two test fixtures
repaired.** Built as designed above — `carnivory` gene, prey-sensing folded into the existing
sense/score/steer mechanism, `effectiveAttackPower`/`effectiveEvasionPower` seam functions,
deferred-queue attack resolution, cannibalism allowed, no artificial safeguard.

The one real bug: a predator that caught up to prey got a fresh attack roll **every tick** it
stayed in range, with no cost for a miss. Even modest per-attempt odds compound to near-certain
death within a handful of ticks under sustained proximity — this produced a real, measured
collapse (100 → 15 population within 200 ticks, most seeds ending near-total extinction by tick
3000) under plain `DEFAULT_PARAMS`, not an edge case. Fixed with `Creature.attackCooldownUntilTick`
+ a new `attackCooldownTicks` param (20): a recovery window after every attack attempt, hit or
miss. This is standard predator-prey-model pacing, not the artificial anti-collapse safeguard Dan
declined — it doesn't prevent collapse, it just stops attacks from being free and infinite. After
the fix, all 8 seeds checked (1-8) settled into healthy, stable populations (140-330) by tick 3000,
instead of 6 of 8 collapsing to near-zero.

Two pre-existing scripted-scenario tests (`taxonomy.test.ts`'s Phase 4 barrier milestone,
`goldenScenarios.test.ts`'s barrier/allopatric split) broke not because of a mechanic bug, but
because their fixed-seed base genome helper happened to draw a high incidental `carnivory` (~0.79)
for a gene the tests were never trying to isolate — carnivory didn't exist when those tests were
written, so that draw was silently inert until now. Fixed the same way those tests already pin
`speed` to avoid movement confounds: pinned `carnivory: 0` explicitly alongside it.

Full test suite green (243 passed, 3 pre-existing skips from Addendum 6 unrelated to this work),
typecheck clean, no performance regression, live-verified in-browser across 25,000+ ticks with real
speciation/extinction events and zero console errors.

## Addendum 8 — closing the open threads before Milestone 3

Before moving on to Milestone 3, Dan asked for a "creative director + engineering director" pass:
step back, audit the codebase for everything the food redesign (Addenda 6-7) left unfinished or
inconsistent, prioritize it, and clear the list — rather than carrying staleness forward into a new
milestone. Eight items were identified and all were completed, in the agreed order:

**Tier 1 — infra/consistency (staleness that would mislead, not break anything today):**
`README.md`'s tick lifecycle rewritten for the actual 12-step `tick()` (trees, creature spatial
index, predation queue/resolve phases); `public/scenarios/*.json` example scenarios regenerated
against current `DEFAULT_PARAMS` via a new permanent `scripts/regen-examples.ts` (they still loaded
under the old patch-based economy via `mergeRunParams`'s graceful fallback, but silently no longer
demonstrated their own premise); `distanceTraveled`/`attackCooldownUntilTick` added to
`testHash.ts`'s determinism snapshot (previously invisible to divergence detection);
`scripts/explore-axis.ts` updated with a `predation` axis-isolation entry and a stale comment fix.

**Tier 2 — the foraging-axis tuning gap:** Addendum 6 left `axisIsolation.test.ts`'s
foraging-in-isolation diagnostic `it.skip`, unresolved after several rounds of patch-geometry
tuning. Turned out not to be a foraging-tuning problem at all — it was the same population
instability the Addendum 7 attack-cooldown bug caused, just manifesting as noise in a different
test. Fixing that bug (already done for Addendum 7) fixed this for free; removed the skips.

**Tier 3 — reinstating what Addendum 7 explicitly deferred:** M2's diet dimension is back in
`SpeciesProfile`/`CapabilityClassifier` (`DietProfile.meatShare`, `omnivore`/`herbivore`/`carnivore`
labels at the same thresholds the old R/B version used); predation's death/diet events already flow
into the existing generic species-card/event-feed UI with no new code needed (verified, not
assumed); `createDietarySpecialistObjective`/`createDietaryGeneralistObjective` reinstated reading
**real demonstrated diet share** from `SpeciesProfile` (not the old genotype-centroid proxy — a
deliberate upgrade, consistent with the "Genome != Capability" principle that layer was built
around) and the **Picky Eaters** challenge came back with them; a new
`createApexPredatorObjective(minPopulation, meatShareThreshold)` and matching **Apex Predator**
challenge were added — both gated by `MIN_DIET_EVIDENCE` so a species with no recorded intake yet
can't false-positive complete an objective. Test coverage added in
`standardObjectives.test.ts` for all three objectives, including the population and evidence gates.

**Verification:** typecheck clean, full suite green (262 passed), benchmark unchanged, and a live
in-browser run confirmed the full pipeline end-to-end — selected the Picky Eaters challenge, ran an
era, watched the objective flip to complete as the founder population's carnivory swung sharply
toward one diet extreme, zero console errors.
