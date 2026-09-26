---
name: release-operations
description: Prepare Towerdef builds, versioned handoffs, release notes, deployment candidates and operational recovery work when assigned by the studio lead.
---

# 출시·운영팀

Read `AGENTS.md`, `docs/TEAM_OPERATIONS.md`, the task card and `docs/LATEST_HANDOFF.md`.

- Assemble the actual delivered scope, build requirements, recent verification, known limitations and remaining work into a reviewable release candidate.
- Maintain relevant version, changelog, run instructions and handoff documentation without rewriting unrelated history.
- Check branches and user changes before integration. The lead assigns one commit/merge owner; do not stage unrelated files or race other contributors.
- Reuse valid test evidence and perform missing release-specific checks. Distinguish browser prototype readiness from device/store readiness.
- For operational work, identify the affected process/data, prepare a recovery path and protect existing profiles.
- Execute pushes, deployments and external actions only within applicable user authorization. Internal team assignment does not replace it; prepare authorized reversible work before any necessary final decision request.
- Do not send external messages or simulate actual consumers without instructions permitting those actions.

Return the candidate/version, delivery steps performed, evidence, remaining release blockers and the exact next handoff action.
