# First-two-stage onboarding pace — 2026-09-26

## Adopted decision

Use the requested timing as **maximum combat duration including the boss**: stage 1 is 120 seconds of waves plus up to 60 seconds for its boss; stage 2 is 240 seconds of mining and has no boss. Root selected **6,400 HP for the first boss** to prioritize the user's requested quick initial success at intended difficulty 1/10. The supporting cohort cleared 19/20 with combination alone and 20/20 with upgrades or dispatch. Those are automated fixed-seed results, not human win-rate estimates. Stage 2 receives no additional enemy strengthening.

The existing 8,000-HP first boss did not require compensation merely because preparation became shorter: every policy retained its former clear count after the timing-only change. **7,200 HP was the smallest tested helpful adjustment**, raising assembly-only clears from 14/20 to 17/20. The selected 6,400 HP instead raises them to 19/20, while summon-only remains 2/20. This is a deliberate onboarding leniency decision, not a claim that the timing change forced the larger reduction. This experiment itself changed no production content or core code; root applies the selected values separately.

## Exact setup and reproducibility

Run `npm run build`, then `node tools/onboarding-pace-audit.mjs`. Detailed evidence, individual seed results, and the full process-loaded content snapshot are saved in `artifacts/onboarding-pace-experiment.json`.

The experiment uses the existing exported `scriptedMatch`, twenty solo seeds (1–20), and five unchanged policies. Six scenarios total **600 matches**. The imported content object is snapshotted once per process, so concurrent builds cannot change a running comparison. Baseline stage overrides are explicitly restored in memory for each scenario. The script restores its stage objects afterward and never writes shared content or core files.

- Baseline stage 1: 12 waves ×150 ticks +600 boss ticks =240 seconds maximum; boss HP 8,000.
- Candidate stage 1: 12 waves ×100 ticks +600 boss ticks =180 seconds maximum; optional boss alternatives are separately labelled.
- Baseline stage 2: 15 waves ×200 ticks =300 seconds; no boss under its mining objective.
- Candidate stage 2: 15 waves ×160 ticks =240 seconds; no boss.
- Ten ticks per second. No support abilities, purchased research, injected resources, or seed-specific overrides. Prior-stage automatic clear recipes are available.
- Starting gold, wave grants, kill bounties, enemy HP/speed/spawn intervals, story HP/duration/rewards, summon odds, recipes, and stages 3–5 remain as loaded. Only the scenario's early-stage wave duration and explicitly labelled first-boss HP differ.

Policies act once per simulated second: no input; summons only; summons plus greedy legal combinations; combinations plus value-based upgrades and capacity sale/rebuy; and that same strategy plus dispatch. These are existing fast bots, not novice input simulations. No fifteen-second decision-delay policy was added.

## Stage 1: shortening preparation preserves the current separation

Clears out of twenty. Every input-policy failure was a boss timeout; no-input failures were overcrowding. No facility condition exists on this stage.

| Policy | Old maximum 240s, HP 8,000 | New maximum 180s, HP 8,000 | New maximum 180s, HP 7,200 | New maximum 180s, HP 6,400 |
| --- | ---: | ---: | ---: | ---: |
| No input | 0 | 0 | 0 | 0 |
| Summon only | 1 | 1 | 2 | 2 |
| Greedy combination | 14 | 14 | 17 | 19 |
| Upgrade | 20 | 20 | 20 | 20 |
| Dispatch | 20 | 20 | 20 | 20 |

Mean **successful** completion times, in seconds:

| Policy | Old, HP 8,000 | New, HP 8,000 | New, HP 7,200 | New, HP 6,400 |
| --- | ---: | ---: | ---: | ---: |
| Summon only | 223.10 (1 clear) | 162.80 (1) | 166.55 (2) | 161.35 (2) |
| Greedy combination | 226.33 | 165.91 | 163.59 | 160.43 |
| Upgrade | 205.55 | 146.05 | 143.57 | 141.12 |
| Dispatch | 204.90 | 144.44 | 142.13 | 139.70 |

Successful-time means use different survivor sets when HP changes; the summon-only mean increasing at 7,200 does not mean the easier boss slowed an individual run.

At the new timing with 8,000 HP, the six failed combination-only runs had mean remaining boss HP 862.60. At 7,200, three remaining failures averaged 668.47 HP; at 6,400, the one failure retained 392.40. Summon-only misses were much larger (mean 2,996.73 remaining HP at the new 8,000 setting). Therefore the smaller optional reduction mainly helps a player who already assembles; it does not make passive roster filling generally sufficient.

The full dispatch policy averaged 41.15→32.15 summons, 6.55→6.30 combinations, and 5.40→6.30 upgrades when moving from old timing to new timing at 8,000 HP. Preparation has less real time, but the same number of wave grants and upgrade opportunities arrive sooner. This helps explain why shortening the stage did not reduce its measured clears. The bot's upgrade scheduling and repeated sale/rebuy are substantial assumptions, not proposed human requirements.

No-input overcrowding occurred at a mean 59.10 seconds before versus 62.40 after the timing change. The deterministic encounter schedule changes its mix sooner, so total runtime does not scale uniformly with wave duration.

## Stage 2: four-minute objective remains forgiving

| Policy | Old 300s clears | New 240s clears | Failure type |
| --- | ---: | ---: | --- |
| No input | 0/20 | 0/20 | Facility destruction in every run |
| Summon only | 20/20 | 20/20 | None |
| Greedy combination | 20/20 | 20/20 | None |
| Upgrade | 20/20 | 20/20 | None |
| Dispatch | 20/20 | 20/20 | None |

Every successful run ends at the mining completion boundary: exactly 300 seconds before and 240 seconds after. No-input facility failure averaged 86.40→86.00 seconds. There are no boss timeouts because the stage does not spawn a boss.

The shortening leaves the fixed story windows valid. Stage 1 stories begin at 30/60/90 seconds and last at most 20 seconds, before the boss at 120 seconds. Stage 2 stories begin at 48/112/176 seconds and last at most 30 seconds, before mining ends at 240 seconds.

## Difficulty labels and limits

“1/10” and “1.5/10” are **intended onboarding difficulty**, not a calculated or human-validated rating. Stage 2's 1.5 reflects its facility-defense learning and objective management. The bot win rates do not support a higher mechanical difficulty: filling its roster clears 20/20, while stage 1 still requires assembly or upgrades in most seeds, even with the adopted boss adjustment. A new facility objective and longer route may add learning load, but this experiment does not measure that load.

Keep the early duration change separate from the proposed three-identical-basic assembly rule, income reductions, or enemy-pressure increases. Those changes alter craft access and material efficiency and would require a fresh comparison. Twenty fixed seeds and fast bots cannot establish novice success probability, reading time, touch usability, multiplayer difficulty, or player satisfaction. The results support the time budget and quantify the optional first-boss leniency; they do not validate an absolute difficulty scale.
