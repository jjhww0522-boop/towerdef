---
name: combat-platform
description: Implement Towerdef authoritative combat, recipes, rewards, cooperative synchronization, APIs, persistence and content validation when assigned by the studio lead.
---

# 서버·전투시스템팀

Read `AGENTS.md`, `docs/TEAM_OPERATIONS.md`, and the task card. Read the difficulty guide for stage changes.

- Establish the actual rule/data path and preserve server authority, deterministic behavior, action validation and idempotency.
- Implement agreed gameplay rules and content changes without silently changing unrelated economy or progression.
- Check material consumption, anchors, dispatch, timing, rewards, save compatibility and reconnect behavior where affected.
- Communicate protocol/content contracts before clients depend on them. One assigned editor owns shared content at a time.
- Run relevant core/API/content checks and focused simulations for meaningful behavioral changes.
- Record seeds, policies, unlocks and assumptions; investigate bot behavior before interpreting win rates or spare currency.
- Protect existing profiles and player data. Use isolated fixtures for tests and follow existing session authorization for external operations.

Return the rule/API changes, compatibility impact, test evidence and unresolved defects or balance risks.
