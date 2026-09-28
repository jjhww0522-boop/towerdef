# Field Mods Implementation Plan

> **For agentic workers:** Use the existing delegated studio workflow with test-first core changes and independent QA. Root integrates; do not commit another owner's work.

**Goal:** Add a mid-expedition choice and later adaptation with one active conditional combat modifier, then show its measured effect.

**Architecture:** The deterministic server owns opportunities, choices and actual hit bonuses. Web and Unity display the same published contract. This extends the current expedition and preserves the gated future roster/chapter migration.

**Tech Stack:** Existing TypeScript core, Node HTTP/tests, browser JavaScript/CSS, Unity C#/UGUI and portable NUnit contracts. No new product dependency.

**Spec:** `docs/design/FIELD_MODS.md`

## Global Constraints

- Content `0.12.0-field-mods`, first-stage 180s maximum / second-stage 240s, difficulty targets 1/1.5.
- One active effect; no permanent growth/currency, no RNG consumption, no free tutorial effect.
- Preserve existing working-tree changes. User has authorized autonomous routine implementation; additional staged approval prompts are not needed.
- Actual devices/participants remain 0 unless actually tested. Native compile is still unavailable locally.

## Review Focus

- Request lost across a checkpoint: replay an acknowledged choice, reject an unacknowledged stale offer without applying another choice.
- Frost first hit: apply the pre-hit control condition, not the slow just inflicted by that hit.
- Already lethal base hit: do not claim extra damage beyond remaining health.
- Spectator/early defeat: own choices and fixed result stats must not become the watched player's choices.
- Small viewport/pending network: never cover tactical controls or confirm a choice before the server responds.

## Task 1 — Server and rules (game_core)

Files: `shared/content.json`, `server/core/index.ts`, `server/protocol.ts`, new `tests/field-mods.test.mjs`, new `tests/field-mods-api.test.mjs`. Extend content validation only if needed in `tools/validate-content.mjs`.

- [x] Write and run failing boundary/selection/real-damage tests from the spec.
- [x] Implement `choose_mod`, opportunity projection and hit accounting; include fields in replay identity and result snapshots.
- [x] Publish the exact spec contract and run focused core/API tests.

## Task 2 — Browser experience (dev_expert)

Files: `playtest/app.js`, `playtest/index.html`, `playtest/operation-ui.css`, new `tools/field-mods-browser-check.mjs`, optional focused presentation model/test.

- [x] Implement nonmodal entry/three choices/current build/retune availability and final real-effect recap using server fields.
- [x] Use existing pending-action retry and retain selected robot/dispatch intent; preserve 44px targets.
- [x] Verify isolated HTTP flows in 360×640,390×844,667×375 and report screenshots/errors. Include stale offer/network retry where practical.

## Task 3 — Native parity and integration (root)

Files: `client/Assets/Scripts/{Protocol,LocalSession,BattleClient,MobileModel}.cs`, `client/Assets/Tests/Editor/MobileModelTests.cs`, `tests/mobile-contract/ServerFixturesTests.cs`, `tools/check-mobile-contract.mjs`, `package.json` and handoff docs.

- [x] Add failing C# contract tests for pending payload preservation and safe display of absent/current/result modifier state.
- [x] Add DTOs, request fields, nonmodal access and actual-effects result recap.
- [x] Update version-sensitive fixtures and run C# contracts plus final `npm test` once integrated.

## Task 4 — Independent QA and balance evidence (game_designer)

Files: new `tools/field-mods-audit.mjs`, new `docs/playtests/2026-09-27-field-mods.md`. Read-only other owners' implementation.

- [x] Prepare a deterministic policy comparison and adversarial review based on actual spec.
- [x] Compare unselected/tracker/scatter/opener/adaptive at recorded seeds and eligible recipes; report actual hit benefit and timing/clear reasons, not human satisfaction.
- [x] Reproduce material findings, assign fixes through root, and record remaining limitations.

No publish or push step is implied. Existing local server/profile data must not be overwritten; use isolated memory/test files.

## Integration evidence (2026-09-27)

- `npm test`: 254 passed, including 9 field-mod core tests and 2 HTTP tests. Initial run was 253/254 because an existing progression API fixture received a randomly assigned port rejected by Node fetch (`bad port`). No product code was changed for this; the full rerun passed. Log: `artifacts/field-mods-regression.log`.
- Portable C# contracts: 16 passed, including original pending payload, immutable personal result, and actual server JSON across survey/retune/leave. New fixture test failed before fixtures were added and passed afterward. This does **not** compile Unity APIs.
- Roslyn syntax/format check: 4 C# files; separate read-only native review found no confirmed defect. Editor, Xcode, touch/scroll on actual phones remain untested.
- Independent balance audit rerun: 200 expeditions plus 10 controlled hit scenarios passed. See the QA report; first two stages also pass without a choice under this policy, so this is not a human difficulty or enjoyment verdict.
- Browser: 14 new flows passed across 360×640, 390×844 and 667×375, including lost response/identical retry, stale opportunity, zero-effect defeat, personal result, boss HUD and 44px control access. Existing position/assembly checks passed in 5 sizes, tutorial 12 and chapter/engine 18 passed. Reports: `artifacts/field-mods/browser-report.json`, `artifacts/position-combat-browser-report.json`, `artifacts/tutorial-browser-report.json`, `artifacts/engine-chapter-report.json`. Root visually inspected portrait, landscape and boss captures; no actual handset was used.
- UI review fixes: ended expeditions show a terminal label instead of a future countdown; landscape entry moved clear of robot slots and boss information. A first boss hit-test incorrectly treated the deliberately non-interactive HUD as an interactive target; its final assertion checks rectangle overlap.
- Isolated preview: `http://127.0.0.1:7352`, PID 31092 at launch, data under `artifacts/field-mods-preview`. Existing port 7351 and its profiles were not changed. Agent-browser verified home → stage → expedition → summon → field-mod panel, with no reported browser/server errors. Screenshots: `artifacts/field-mods-preview`.
