# Economy and normal-wave pressure audit — 2026-09-26

**Recommendation: address ordinary-wave pressure and visible spending decisions before cutting income globally. No production values were changed.** The user's observation that enemies disappear and money can accumulate is supported by the current build. Low bot bank balances previously concealed a costly sale/rebuy habit that humans need not follow.

## Reproduction and assumptions

Build current `0.11.0-reignition`, then run `node tools/economy-audit.mjs`. The report is `artifacts/economy-pressure-audit.json`: 900 solo matches, seeds 1–20, five stages, upgrade and dispatch policies, baseline plus three in-memory proposals, and an additional baseline dispatch cohort without capacity sale/rebuy. This is simulation, not human research. Nothing edits the authoritative core, shared content, or progression data.

The harness loads the **exact existing** private policy from `simulate.mjs` into an isolated module after exposing its function in memory. It fails if that entry changes. The hold-at-cap variant changes only the sale/rebuy branch. Policies act once per simulated second; upgrades occur at most once per wave boundary, including later clock boundaries during boss combat. Prior-stage automatic recipes are available; paid research and tactical supports are absent. Money checkpoints are 25/50/75/100% of ordinary-wave duration, not the boss deadline. Checkpoints never reached are excluded and carry a `reached` sample count. Gold ledgers and unchanged shared content are checked by the script.

## Current pressure: experienced bots hardly defend the facility

Means across twenty baseline dispatch runs; upgrade-only results are similar and included in the JSON.

| Stage | Normal spawns | Normal kills | Killed before evacuation | Peak normal enemies | Peak / 35 reference | Empty-field ticks | Facility arrivals | Normal facility HP lost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 119 | 119 | 100% | 2.00 | 5.7% | 97.25% | N/A | N/A |
| 2 | 222 | 220.05 | 99.12% | 6.15 | 17.6% | 10.07% | 0 | 0% |
| 3 | 336 | 330.65 | 98.41% | 10.40 | 29.7% | 5.73% | 0 | 0% |
| 4 | 529 | 525.05 | 99.25% | 10.90 | 31.1% | 7.50% | 0 | 0% |
| 5 | 931 | 923.90 | 99.24% | 11.85 | 33.9% | 0.56% | 0 | 0% |

The 35-enemy ratio is only a common visual reference: stages 2–5 do **not** lose through overcrowding. Enemies travelling through an open route explain non-empty fields; the stronger evidence of low pressure is zero arrival and zero facility loss. Approximate normal kills per minute are 39.7 / 44.0 / 47.2 / 52.5 / 61.6 respectively. Arrival detection includes enemies that arrive and die during the same tick, because siege resolves before robot attacks.

Clears for upgrade / dispatch were 20/20, 20/20, 12/14, 13/15, and 12/13 out of twenty. Every failed informed run was a **boss timeout**, not a loss during ordinary waves. Thus a lower clear rate alone would falsely suggest that the middle of the run is difficult. Stage 1 especially offers little actual combat pressure: its field is empty for over 97% of normal ticks.

## Cash: low bot balances hid automatic reroll spending

Baseline dispatch means. Earned income excludes starting 150 and includes kill, wave, and mission income; refunds are separate. Combination and dispatch cost no gold.

| Stage | Earned gold | Summon spend | Upgrade spend | Sale refunds | Sales/rebuys | Ending bank |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 747 | 823 | 233 | 174 | 24.60 | 15.30 |
| 2 | 1,150 | 1,026 | 475 | 216 | 30.40 | 15.40 |
| 3 | 1,973 | 2,048 | 567 | 506 | 71.45 | 14.85 |
| 4 | 2,909 | 2,760 | 948 | 664 | 93.45 | 14.80 |
| 5 | 5,267 | 5,460 | 1,402 | 1,458 | 205.40 | 14.25 |

The bot sells the lowest estimated-value eligible robot and buys another whenever it has funds at capacity. Each basic sale returns 7 of the 20 spent: repeated rolls continuously burn 13 gold. This is not evidence that normal users face a tight economy. Stage 5 averages 273 total summons to maintain only 20 slots.

Remove that sale/rebuy loop while retaining the same crafting, upgrades, and dispatch decisions:

| Stage | Bank at 25% | 50% | 75% | 100% normal waves | End including boss | Full roster + ≥20 gold, % normal time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 60 | 131 | 214 | 201 | 69 | 72.54% |
| 2 | 10 | 93 | 170 | 253 | 253 | 67.30% |
| 3 | 22 | 144 | 323 | 419 | 112 | 68.93% |
| 4 | 95 | 346 | 744 | 912 | 504 | 68.88% |
| 5 | 146 | 597 | 1,199 | 1,488* | 1,042 | 70.60% |

*Stage 5 final normal checkpoint includes 18 surviving runs, versus 20 at earlier checkpoints. First-stage first combine averaged 7.05 seconds for the normal dispatch policy; holding the roster does not delay that initial action. Its average first capacity is 37.30 seconds before the hold/churn paths diverge.

These are **affordable-but-held funds**, not proof that every upgrade is exhausted. Held-roster average upgrade levels at the end were 11.2 / 12.55 / 21.45 / 25.35 / 36.65 out of 45, with 0 / 0 / 0.35 / 1.2 / 5 fully maxed tags. The policy's one-upgrade-per-wave rule also contributes to the bank. All nine tag tracks cost 4,500 total gold to max; early surplus cannot be explained by hitting all upgrade caps. The actual issues are early slot saturation, already sufficient wave damage, no price on combining, and weak urgency to reinvest. Later caps add to that problem but are not its sole cause.

## Three proposals tested only in memory

No proposal changes boss HP, boss deadlines, recipes, facility HP, or ability values.

1. **Economy only:** starting gold 100; wave grant ×0.60 rounded; wave-grant growth ×0.50 rounded; base kill bounty 1.
2. **Pressure only:** normal HP-per-wave ×1.60; quadratic HP growth ×1.50; initial and minimum spawn intervals ×0.85 rounded.
3. **Moderate combined:** starting gold 120; wave grant ×0.75 rounded; kill bounty 1; normal HP-per-wave ×1.35; initial/minimum spawn intervals ×0.90 rounded.

| Variant | Dispatch clears, stages 1–5 (/20 each) | Peak enemies, stages 1–5 | Normal facility loss, stages 2–5 |
| --- | --- | --- | --- |
| Current | 20 / 20 / 14 / 15 / 13 | 2.00 / 6.15 / 10.40 / 10.90 / 11.85 | 0 / 0 / 0 / 0% |
| Economy only | 20 / 20 / 11 / 4 / 2 | 2.15 / 9.25 / 16.65 / 15.35 / 16.95 | 0 / 0 / 0.03 / 4.24% |
| Pressure only | 20 / 20 / 11 / 13 / 12 | 2.15 / 13.40 / 21.75 / 16.45 / 19.45 | 0 / 0 / 0.24 / 0.47% |
| Moderate combined | 20 / 20 / 10 / 9 / 7 | 2.10 / 10.35 / 18.95 / 16.45 / 19.10 | 0 / 0 / 0.04 / 3.36% |

All informed-policy failures in these candidate cohorts still occurred at the boss deadline. The economy-only cut reduced stage-5 wins from 13 to 2 without producing meaningful mid-run facility risk. **Do not ship that blanket cut.** Pressure-only is the most promising of these probes for visible buildup, but even it leaves stage 1 empty 93.71% of normal ticks and gives little actual facility pressure. It is evidence that modest global coefficients alone are insufficient, not a recommended finished balance.

Reducing spawn intervals also adds kill income: pressure-only increased stage-5 dispatch earned gold from 5,267 to 5,631. Compensating bounty/total-wave reward must therefore be considered when adding bodies. Conversely a base bounty of 1 interacts with the minimum-one-gold swarm payout, so swarm income does not fall proportionally with other roles.

## Recommended next discussion and isolated experiments

1. **Define normal-wave success separately from the boss.** Record arrivals, health lost, time spent with a visible backlog, and recovery after each announced encounter. Keep bosses unchanged while tuning these. A first test target could be occasional recoverable backlog after wave 3, not constant lane collapse; exact targets need play observation.
2. **Concentrate encounters instead of merely slowing long streams.** Test short, forecasted batches with roughly conserved total wave HP and reward, followed by recovery time. The existing two-at-a-time swarm rarely challenges a developed roster. Test a stage-specific stronger packet rather than stacking global gold reduction with global HP growth. This is a proposed next experiment, not a measured outcome here.
3. **Expose what the next investment solves.** At capacity, identify a reachable assembly/upgrade choice and its affected robots. Do not treat selling and buying hundreds of times as the intended money sink. Consider offering a deliberate paid reposition or focused draw only after its rule and opportunity cost are designed; neither was implemented or validated in this audit.
4. **Test the user's three-identical-basics rule independently first.** Three inputs raise nominal material cost from 40 to 60 and can reduce the chance of an early legal craft. It is not automatically an economic buff. Recheck first craft, full board without a recipe, time waiting for a duplicate, two lost attack positions, and sale/rebuy burden before combining that recipe change with tighter income. Preserving elite stats while increasing inputs can also make some low-primary-damage recipes poor trades against the three originals.

No recommendation here is a human win-rate claim. Strong bots are unusually fast, know future unlocks, and make expensive repetitive moves. Twenty seeds are a controlled diagnostic cohort. The current results support the complaint about weak normal-wave pressure, identify a misleading bot economy metric, and reject several broad nerfs; they do not establish a final difficulty curve.
