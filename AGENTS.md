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
