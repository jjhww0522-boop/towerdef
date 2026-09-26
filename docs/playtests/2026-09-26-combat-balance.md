# Reignition combat iteration — 2026-09-26

This is automated deterministic simulation evidence, not human playtest or device-performance evidence. The starting revision was `a8ad01e`, content `0.10.1-training-combat`; adopted content is `0.11.0-reignition`.

## Change and rationale

The existing robots already differed in range, blast/chain targeting, and frost travel slowdown. Normal enemies did not. This update gives those existing choices readable encounters and adds optional local emergency support. It does not change summon odds, random placement, selected-ingredient anchoring, sale refunds, recipe progression, engine entry, tutorial checkpoints, or the five objective durations.

Waves 1–2 contain grunts. Waves 3 onward repeat runner, swarm, plated, grunt. Each next wave is guaranteed and exposed before arrival. Spawns occur at positive multiples of the wave's interval, excluding the following boundary; forecast count is `floor((waveTicks - 1) / interval) * batchSize`. Every batch cycles to the next route; a swarm pair shares one route and position, making existing blast and chain attacks useful. The schedule consumes neither summon RNG nor placement RNG.

| Role | HP multiplier | Speed | Facility damage | Kill-gold multiplier | Encounter pacing |
| --- | ---: | ---: | ---: | ---: | --- |
| Grunt | 1 | 1 | 1 | 1 | Existing base interval |
| Runner | 0.65 | 1.5 | 1 | 1 | Existing base interval |
| Plated siege robot | 1.6 | 0.7 | 2 | 1.5 | Interval ×1.5, rounded |
| Swarm | 0.6 | 1 | 0.75 | 0.5 | Pairs, interval ×1.5, rounded |
| Boss | Configured boss HP | 1 | 6 | 1 | Existing evacuation boundary |

Plated enemies have no armor reduction, resistance, or immunity. Their role is entirely HP, travel speed, and siege damage. Bounty is rounded with a minimum of one gold; at the existing two-gold base, each swarm pays one. A pair therefore does not double a normal bounty.

Supports share a 400-tick/40-second cooldown and cost no gold. Overdrive multiplies actual home damage by 1.5 for the next 60 ticks; it does not reset weapon cooldowns or affect dispatched story damage. EMP freezes movement and siege timers on enemies currently present for the next 30 ticks, or 10 ticks for bosses. Later arrivals are not stunned. EMP does not deal damage. A player chooses one support and cannot use the other until the shared deadline. Empty uses fail without starting the cooldown. Tutorials reject both. Neither support contributes to the investment-action threshold for rewards.

Oldest reachable target priority was deliberately preserved. Changing target priority at the same time would make role/support comparisons harder to interpret and would alter explicit existing attack invariants.

## Measurements and iterations

Policies act once per simulated second through real `applyAction` calls. They use the existing placement-coverage heuristic to anchor recipes. No seeded outcome overrides or injected units/resources are used.

- `no-input`: no actions.
- `summon-only`: buys robots when gold, cooldown, and slots permit.
- `greedy-combine`: summons and repeatedly crafts an available recipe, highest recipe list position first.
- `upgrade`: adds once-per-wave tag-value upgrades and replaces the lowest estimated-value robot at capacity.
- `dispatch`: adds up to two high-value robots to active shared missions under the existing policy conditions.
- `overdrive` support: checks once per second and activates whenever ready, an enemy exists, and a home robot exists.
- `emergency-emp` support: checks once per second and activates at 60% of the overcrowd limit, or at least three enemies at progress ≥0.85 on a facility map.

Each later stage starts with the automatic clear recipes from preceding stages, but no purchased research recipes. Results below are fixed seeds 1–20; solo and four-lane cohorts are explicitly distinguished because the shared summon stream and story contributions differ.

### Initial baseline and role-only iteration

Stage 1, four lanes ×20 seeds (80 lanes), no supports:

| Policy | Before update | New roles, unchanged boss |
| --- | ---: | ---: |
| No input | 0/80 | 0/80 |
| Summon only | 2/80 | 2/80 |
| Greedy combine | 59/80 | 58/80 |
| Upgrade | 80/80 | 80/80 |
| Dispatch | 80/80 | 80/80 |

Both dispatch cohorts completed 60/60 shared stories. The role schedule changes what arrives without requiring support to preserve the introductory informed strategy.

The initial pre-update solo five-seed spot check for dispatch cleared stages 2/3/4/5 in 5/1/2/1 runs. After adding roles, the same spot check was 5/2/2/1. Later losses were boss timeouts, so a larger cohort tested boss health separately.

### Boss bottleneck adjustment

Twenty solo dispatch seeds, comparing the role-enabled build before and after the only global difficulty adjustment:

| Stage | Boss HP before → adopted | No-support clears before → adopted | Repeated-overdrive clears before → adopted |
| --- | ---: | ---: | ---: |
| 3 | 30,000 →25,500 | 12→14 | 12→15 |
| 4 | 70,000 →59,500 | 9→15 | 13→15 |
| 5 | 135,000 →114,750 | 6→13 | 9→13 |

All changes are a 15% reduction. Deadlines, normal-enemy health curves, starting funds, income, and facility HP remain unchanged. This relieves an existing final DPS bottleneck rather than increasing normal-enemy pressure to require support. The adopted overdrive cohort still has losses; repeated support alone does not guarantee success.

### Adopted five-stage comparison

Clears out of 20 solo seeds, without supports:

| Stage | No input | Summon only | Greedy combine | Upgrade | Dispatch |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 1 | 14 | 20 | 20 |
| 2 | 0 | 20 | 20 | 20 | 20 |
| 3 | 0 | 0 | 0 | 12 | 14 |
| 4 | 0 | 0 | 0 | 13 | 15 |
| 5 | 0 | 0 | 0 | 12 | 13 |

The mining stage remains forgiving: merely filling its roster cleared this cohort. No-input still loses every stage. The later-stage informed policies produce both successes and failures and clearly outperform summoning or crafting alone. All informed-policy losses were boss timeouts; this is still a roster/coverage bottleneck, not proof of broadly balanced encounters.

With dispatch plus cooldown overdrive, clears were 20/20/15/15/13 across stages 1–5. Mean completion time changed from 204.900/300/492.740/678.495/980.780 seconds to 202.070/300/489.595/675.175/977.640. The strongest scripted armies never triggered the emergency-EMP policy, so those equal results do **not** establish EMP's usefulness for them.

We also ran both support policies on weaker greedy-combine armies. EMP was used 7, 17, and 63 times in the twenty runs of stages 3, 4, and 5. At stage 4, facility losses fell from 3 to 1 (the surviving runs still timed out against the boss); at stage 5 mean survival rose from 880.850 to 887.520 seconds. It did not turn these weak armies into clears. Repeated overdrive yielded one stage-3 greedy clear, zero in stages 4/5. This distinguishes temporary relief from replacing roster development.

## Public contract

`state.encounter` is null for a tutorial; otherwise `{ current, next, remainingTicks }`. Each encounter has `{ wave, label, description, archetype, count, startTick, spawnIntervalTicks, routeCount }`. `next` is null after the boss or on the last mining wave. The boss uses the final wave number, count 1, spawn interval 0, and its real arrival tick. `remainingTicks` counts to the current wave end or boss deadline; it is not a promise that all surviving enemies disappear at that boundary.

Enemies expose `archetype: grunt|runner|plated|swarm|boss` and `stunned: boolean`, retaining existing `boss`, `slowed`, route, progress, and attack telemetry. Missing archetypes on legacy test fixtures default to grunt/boss. No client should infer archetypes from health.

`player.tactical` contains `{ cooldownRemainingTicks, overdriveRemainingTicks, lastUseTick, lastKind }`. The initial stamps are null. Command shape: `{ seq, type: 'tactic', tactic: 'overdrive'|'emp' }`. The tactic discriminator participates in the replay key. Reusing the sequence with another tactic fails; identical retransmission returns the original result without another effect or cooldown extension. Errors: `UNKNOWN_TACTIC`, `TACTIC_COOLDOWN`, `NO_HOME_UNITS`, `NO_ENEMIES`, plus existing tutorial/connection/status errors.

`player.battleStats` and a copied `result.battleStats` contain `{ kills, damageDealt, facilityDamageTaken, tacticsUsed: { overdrive, emp }, biggestHit, peakEnemies }`. Damage and biggest hit count actual clamped home-enemy damage, excluding overkill and shared story damage. Facility damage is also clamped to remaining HP. Terminal result counters are copied so subsequent state changes cannot rewrite the debrief. Stats do not alter reward eligibility or credit amounts.

## Verification and reproduction

Before implementation: existing build and 197 tests passed. Ten added domain checks cover guaranteed encounter counts/roles, independent RNG, boss/mining/tutorial forecasts, role speed and siege behavior, no hidden resistance, exact support durations, shared cooldown, identity-sensitive replay, serialization, lane/story isolation, empty-use failures, frozen stats, same-route swarm payouts, idle attack signals, later-arrival EMP exclusion, and deterministic legal scripted supports.

Run `npm test` for integrated regression coverage. Run `node tools/simulate.mjs --combat` after building for all five stages ×20 seeds ×nine policy combinations (900 solo matches), including per-seed results and battle counters. Existing `--compare` retains its four-lane stage-1 comparison; default simulation and stress output remain available. `scriptedMatch` accepts `options.supportPolicy` with default `none`.

Limits: twenty fixed seeds are a regression sample, not population win-rate estimates. The bot's once-per-second greedy actions and coverage heuristic are not human decisions. No-input defeats do not demonstrate readable feedback. This work does not establish real-device performance, multiplayer network reliability, player enjoyment, long-term retention, or production release readiness. Shared support selection is mechanically meaningful, but human use frequency and EMP discoverability still require observation.
