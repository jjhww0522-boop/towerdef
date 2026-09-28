# Six-element roster and opening economy implementation plan

> **For agentic workers:** Use the assigned studio roles; one editor per file. Execute and verify each task before integration.

**Goal:** Activate the approved 25-unit, six-element roster and make the first stage start with three affordable summons instead of seven.

**Architecture:** Keep the existing authoritative combat engine and shared content. Replace the roster and recipes as one versioned change, migrate account research once, and adapt the existing web/native presentation and training flow.

**Tech Stack:** TypeScript core, Node test runner/server, browser JavaScript/Canvas, Unity C# source.

**Spec:** `docs/design/SIX_ELEMENT_ROSTER.md`, `docs/design/DIFFICULTY_SCALE.md` and the user's instruction to implement and reduce the 150-gold opening.

## Global constraints

- Six families with four units each plus one shared S; exactly 25 units and 24 recipes. Same unit three times per recipe.
- IDs `{fire,water,frost,wind,electric,laser}_{1,2,3,4}` and `guardian_s`; recipes `make_{element}_{2,3,4}` / `make_guardian_s_{element}`.
- Tier 1/2/3/4 use existing basic/elite/hero/legend rarity; S uses legend with tier ultimate.
- Basic summons only, equal choice among six; weights `[10000,0,0]` preserve the existing rarity protocol.
- T2 is initially available; T3 is available after stage 2 clear. T4/S recipes are explicitly future content, locked in ordinary accounts. Do not invent chapter 2 or expose nonexistent stage 6 as an instruction.
- Stage 1 remains difficulty 1, 120 seconds plus at most 60 seconds for its boss; stage 2 remains difficulty 1.5 and 240 seconds. Starting gold candidate 60, summon cost 20; final other balance values require fixed-seed measurements.
- Preserve existing clears, research balance, engines, tutorial completion and stats. Retired paid recipe research gets an idempotent refund of its original cost.
- Existing dirty work stays intact. No deployment or push in this task. Briefing/speed changes are separate requests.

## Review focus

- Full inventory with no triple: measure recovery through existing sale/summon; do not assume triples are guaranteed with 10 slots.
- Common S has six recipes: validate every route and display only the focused family path.
- Legacy account reopened repeatedly: no repeated refunds or erased clear history.
- Training has fixed draws: teach three identical materials and keep sale/anchor/paused combat meaningful.
- Basic-only draws remove rare units: tune for accessible ordinary play and report bots separately from human difficulty.

## Task 1 — Content and balance (lead, with independent balance agent)

- [x] Add and run failing `tests/roster-content.test.mjs` for 25 names, six paths, three identical ingredients, equal basic-only pool, and three-summon stage 1 opening.
- [x] Replace units/recipes in `shared/content.json`, bump content version, set explicit early stage budgets and candidate stats.
- [x] Run fixed-seed stage 1/2 simulations with no input, summons only, combinations, and upgrades; measure first combination, full-slot stalls, remaining gold and outcomes. Adjust content using evidence and retain stage time/difficulty targets.
- [x] Verify tests and document actual numbers/limits in the balance report and handoff.

## Task 2 — Rules, validation, training and account migration (platform team)

- [x] Write failing migration/training behavior tests, then implement in `server/core/index.ts`, `tools/progression.mjs`, `tools/validate-content.mjs` and affected server paths.
- [x] Validate six routes to one S without weakening duplicate/cycle/reference rejection. Future recipes remain unavailable through the account API.
- [x] Preserve account fields and refund four retired purchases once (60/100/160/240 research credits), testing repeated reads/reloads.
- [x] Adapt old fixtures to triple recipes and six basic draws while retaining their behavioral assertions; run core/API test suite.

## Task 3 — Web/native presentation and appliance art (client team)

- [x] Adapt selected-unit evolution, collection/research labels, probability copy, training instructions and water effects in `playtest/**` and `client/**`.
- [x] Draw distinct appliance silhouettes through the existing procedural art path; reuse family shapes for early bosses where supported. Record that this is procedural art, not final bespoke production art.
- [x] Adapt tutorial layout in `shared/battle-geometry.js` and visual/mobile contract tests; ensure future recipes do not advertise a nonexistent stage or charge credits.
- [x] Verify mobile portrait/landscape selection, triple assembly, missing materials and tutorial completion with a local browser. Native source checks do not claim device execution.

## Task 4 — Integration and independent QA

- [x] Run `npm test`, relevant browser flows and mobile contract checks after all changes land.
- [x] Independently review economy, migration, six-family visuals and common-S behavior; fix material findings and rerun affected checks.
- [x] Serve the new local preview, verify its actual content version, and report implemented, locked future content, automated evidence and remaining human/device/art validation separately.

## Execution record

Completed on 2026-09-27; see docs/playtests/2026-09-27-six-elements-rollout.md for actual outcomes. Selected stage 1 waveGold22/boss4800 and stage 2 waveGold24/enemy coefficients26,20,0.6 from fixed-seed comparisons. Late boss health adjusted to38000/90000 after regression comparison; durations unchanged. S damage increased to3000 because blast primary damage is80% and must exceed three fire T4 inputs. Old bosses remain visually unchanged; shared appliance bosses are deferred. No commit/push; existing dirty work preserved. Final Node268/268; native contracts17/17; browser flows passed, no device/human validation.
