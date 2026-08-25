# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` loads this file through `@AGENTS.md`; keep the guidance tool-agnostic.

## Project and sources of truth

**Harnest** is a web control room that freezes a judging procedure after user validation and approval, then iteratively improves an artifact against that procedure.

- Current product policy and invariants: `SPEC.md`
- Exact fields, types, and execution contracts: `packages/contracts` and their tests
- Design rationale: `PHILOSOPHY.md`
- Unimplemented or deferred scope: `ROADMAP.md`
- Empirical evidence: `experiments/`

Drafts and archived documents are not current contracts. Before changing an invariant, inspect the relevant SPEC section and contract tests.

## Commands

Node 22 or later is required. Run these commands from the repository root.

```bash
npm install
npm run dev            # Web SPA — http://localhost:5173
npm run build          # Production web build
npm run typecheck      # tsc --noEmit across all workspaces
npm test               # All Vitest tests
npx vitest run packages/loop-engine/src/engine.test.ts
npx vitest run -t "체크포인트"
```

The backend is optional and only persists projects and results.

```bash
cd apps/api
pip3 install -r requirements.txt
python3 -m uvicorn main:app --port 8000
python3 test_api.py
```

There is no linter. Match verification to the scope of the change.

- TypeScript contract, engine, template, or web changes: `npm run typecheck` and relevant tests
- Web behavior or build configuration changes: add `npm run build`
- API changes: run `python3 test_api.py` from `apps/api`
- Cross-layer changes or release checks: run the full suite

## Structure

```text
packages/contracts    Evaluation Pack, examiner, checkpoint, and digest contracts
packages/loop-engine  Browser improvement loop with checkpoint and resume support
templates/handover    Handover questions, compilation, scoring, and generation
templates/timetable   Deterministic template for development and testing
apps/web              React SPA with OpenAI, Gemini, and mock model clients
apps/api              Optional FastAPI + SQLite persistence API
experiments           Frozen protocols, measurement code, and results
```

The dependency direction is `contracts` ← `loop-engine` / `templates/*` ← `apps/web`. The web app composes template-specific behavior through the `TemplateEntry` boundary.

## Core guardrails

- `definitionDigest` is the SHA-256 of `digestScope()`. Its scope includes all of `packVersion`, `templateId`, `criteria`, `gates`, `judgeProcedure`, and `holdoutPolicy`; changing any of them requires re-approval.
- Do not resume a checkpoint when its `packDigest` differs from the current `definitionDigest`.
- The engine does not mutate the supplied pack or scorer. Only candidates that pass the gates enter the adoption decision. The current adoption rule requires a **strict scalar score improvement**: ties keep the existing champion, so the champion curve never declines.
- Score the holdout only at round 0 and at the end. Do not use holdout questions or scores for generation, adoption, or stopping decisions.
- Examiner reports bind to the judging procedure through `forDigest`, not from inside the pack. Revising the criteria changes the digest, mechanically invalidates the previous report, and the approval screen re-runs validation automatically (auto-start at most once per digest; further runs are user-initiated). The battery checks only what varies per run — the chosen judge model (stability, fabrication/sycophancy resistance); deterministic code is covered by unit tests, and arithmetic properties of the configuration surface as compile-time notices.
- Deterministic-only templates are exempt from examiner validation, and the UI must disclose that exemption.
- Do not add template-specific branches to pages or the engine. Keep trust boundaries and composition responsibilities in the template registration interface.
- Store BYO API keys only in browser `localStorage`. Send model request bodies directly from the browser to the selected vendor, never through the Harnest server. Project and result data that the user explicitly chooses to persist is the exception.
- Never commit credential files such as `*.key.json` or raw API keys.

## Contribution conventions

- Use Korean by default for user-facing UI, core project documentation, code comments, and commit messages. Keep this agent guidance in English. Do not force translations of identifiers, API or library names, standard technical terms, or externally established terminology; clarity takes priority.
- Update SPEC only when policy or an invariant changes. Put future work in ROADMAP, empirical observations in `experiments`, and ordinary implementation history in Git. Avoid duplicating the same content across documents.
- Cite SPEC sections only in code or tests that directly implement a non-obvious invariant. File-header citations are not mandatory everywhere.
- Do not rewrite frozen experiment protocols or raw observations as part of cleanup. If a correction is necessary, append a correction record with a reason and an absolute date.
- Keep the user-facing product framing centered on a control room. Explain internal algorithm terms only when they help the user understand the behavior.
