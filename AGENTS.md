# AGENTS.md

Project instructions for Codex and other coding agents working in this repository.

These guidelines are adapted from `CLAUDE.md`. They are meant to reduce common LLM coding mistakes and should be merged with any task-specific user instructions.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Do not assume, do not hide confusion, and surface tradeoffs.**

Before implementing:

- State assumptions explicitly when they affect the solution.
- If multiple interpretations exist, present them instead of silently choosing.
- If a simpler approach exists, say so.
- Push back when a requested change seems risky or unnecessarily complex.
- If something is unclear enough to affect correctness, stop, name what is confusing, and ask.

## 2. Simplicity First

**Write the minimum code that solves the problem. Nothing speculative.**

- Do not add features beyond what was asked.
- Do not create abstractions for single-use code.
- Do not add flexibility or configurability that was not requested.
- Do not add error handling for impossible scenarios.
- If a solution grows much larger than needed, simplify it before finishing.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what is necessary. Clean up only your own changes.**

When editing existing code:

- Do not improve adjacent code, comments, or formatting unless required.
- Do not refactor things that are not part of the request.
- Match the existing style, even if another style would also work.
- If unrelated dead code is noticed, mention it instead of deleting it.

When your changes create unused code:

- Remove imports, variables, functions, or files made unused by your own edits.
- Do not remove pre-existing dead code unless explicitly asked.

The test: every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria and loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" means write or run checks for invalid inputs, then make them pass.
- "Fix the bug" means reproduce it when practical, then verify the fix.
- "Refactor X" means preserve behavior and run relevant checks before finishing.

For multi-step tasks, use a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria allow independent progress. Weak criteria, such as "make it work," require clarification.

## 5. Repository Etiquette

- Prefer existing project patterns, dependencies, and helper APIs over introducing new ones.
- Keep diffs small and reviewable.
- Do not overwrite or revert user changes unless explicitly asked.
- Run the most relevant available checks after edits, and report if a check could not be run.
- In final responses, summarize what changed and how it was verified.

These guidelines are working if diffs are smaller, rewrites due to overcomplication are rarer, and clarification happens before implementation mistakes.

## 6. AI Studio Team Dispatch

- The user appoints the primary assistant as the studio lead (대장). The lead interprets incoming work, assigns the appropriate teams, integrates results, and reports to the user. The user does not need to select teams.
- Use [the team operating guide](docs/TEAM_OPERATIONS.md) for substantive tasks and load only the relevant role profiles from `.cursor/agents/`. Team delegation is explicitly requested; use actual available agent tools when useful.
- Six teams: 기획·밸런스팀, 클라이언트·UI/UX팀, 서버·전투시스템팀, 아트·사운드팀, QA·플레이테스트팀, 출시·운영팀.
- Handle small changes directly. Delegate only concrete, bounded tasks that can proceed alongside useful lead work. Respect the available concurrency limit; six roles do not require six simultaneous agents.
- Assign one editor per file at a time. Share required contracts before parallel implementation. Dependent work waits for its prerequisites. The lead assigns the commit/integration owner separately.
- Developers verify their changes. Use independent QA for material combat/economy, persistence, synchronization, or core-input changes; do not rerun every check merely because a different team reviews it.
- Preserve existing user authorization and autonomy preferences. Team assignment does not itself grant permission for payments, sensitive-data disclosure, destructive operations, or external communication. Follow the applicable session authorization and higher-priority instructions.
- Report implemented changes, evidence, and remaining limitations. Distinguish agent review and simulated player personas from actual human playtests. Do not claim work by a team that was not invoked.
- Future stage design follows [the common 1–10 difficulty scale](docs/design/DIFFICULTY_SCALE.md). Early stages prioritize short, forgiving success experiences; do not silently revert to earlier difficulty targets.
