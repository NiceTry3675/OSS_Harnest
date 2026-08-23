# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` is a symlink to this file, so Claude Code (claude.ai/code) reads it as well — keep the content tool-agnostic.

## Project

**Harnest** — a web service that builds autonomous improvement loops: the user approves an evaluation procedure (frozen, untouchable by the loop), and the AI revises its output against it until it passes. Open-source contest entry. All docs, code comments, and commit messages are in **Korean** — keep it that way.

The single source of normative truth is **SPEC.md §3** (PHILOSOPHY.md holds rationale, interview_schema.md holds citations — neither restates definitions). Design decisions are recorded in SPEC with dates; open items live in SPEC §12 in priority order. Before touching anything invariant-related, check the relevant SPEC section.

## Commands

Requires Node 22+. From the repo root:

```bash
npm install
npm run dev            # web SPA — http://localhost:5173
npm run typecheck      # tsc --noEmit (root tsconfig covers all workspaces)
npm test               # vitest run — all *.test.ts across workspaces
npx vitest run packages/loop-engine/src/engine.test.ts   # single file
npx vitest run -t "체크포인트"                             # filter by test name
```

Backend (optional — only for persisting results; the web app skips it when absent):

```bash
cd apps/api
pip3 install -r requirements.txt
python3 -m uvicorn main:app --port 8000
python3 test_api.py    # API tests (round-trips every endpoint against a temp DB)
```

There is no linter. The full check is `npm run typecheck && npm test` plus `python3 test_api.py`.

## Architecture (npm workspaces monorepo)

```
packages/contracts    Contract types — "the spec is types, not prose".
                      pack.ts (EvaluationPack, digestScope), loop.ts (checkpoints),
                      examiner.ts (validation report / calibration), digest.ts
                      (canonical JSON → SHA-256)
packages/loop-engine  Browser hill-climbing loop engine (planned standalone release).
                      Seeded RNG (mulberry32, state preserved), checkpoint every
                      round (IndexedDB), pause/resume, plateau early-stop
templates/*           One folder = one template: questions, compile, scorer, mutator.
                      timetable = fully deterministic (pipeline debugging),
                      handover = flagship (LLM case_answering)
apps/web              React SPA — wizard → approval (lock) → console → results.
                      templates.tsx is the template registry, state.tsx the single
                      cross-page context, lib/llm.ts the BYO Gemini/mock client
apps/api              FastAPI + SQLite CRUD. Executes no arbitrary code — stores and
                      returns approved procedures verbatim
experiments/delta-01  One-shot-delta measurements (Python) — NOT app code. PROTOCOL.md
                      is frozen before scoring; any later edit must land as a diff
                      with an explicit reason
```

Dependency direction: `contracts` ← `loop-engine` / `templates/*` ← `apps/web`. The backend talks to the web app only via contract JSON.

## Core invariants (contracts the code enforces — do not break without revisiting SPEC)

- **The unit of freezing is the entire judging procedure**: `definitionDigest` = SHA-256 of `digestScope()` (criteria + gates + judgeProcedure + holdoutPolicy), computed and frozen at approval. Any field change breaks the digest. Editing criteria = recompile = **re-approval**.
- **A checkpoint belongs to the procedure that produced it**: if `packDigest !== definitionDigest`, resume is refused (the digest guard in loop-engine).
- **The loop engine has no code path to modify the scorer or the pack** — it only calls functions passed in as options.
- **Adoption only on strict scalar improvement** (ties keep the champion). Gate-rejected candidates never enter the adoption decision. The improvement curve records only the post-adoption champion score — declines included, unedited.
- **Holdout is scored only at round 0 and at the end**; no signal derived from holdout scores may flow into generation, adoption, or stopping. Holdout cases never enter Generator/Critic context.
- **Validation report and calibration are bound via `forDigest`** (they cannot live inside digestScope — self-reference). They are NOT cleared on recompile: the mismatch itself drives the "edit → re-validate round-trip" UI. Approval blocking is decided by `approvalBlockers()`, with `approve()` as a second line of defense. A failed calibration is sticky — the only exit is editing the criteria, never retrying the judged pairs.
- **Deterministic-only loops are exempt** (SPEC §10 special cases): no validation report/calibration, no pairwise — and the exemption is displayed on screen, never hidden.
- **Hard gates are doors, not scales** — they carry no weight and cannot be bought back with style points.
- **Boundary principle (SPEC §6)**: a template declares the range of trusted parts; engine and pages compose within that range. Pages must know only the `TemplateEntry` interface — per-template branches appearing in engine or page code are a red flag.
- **BYO privacy**: API keys stay in browser localStorage and requests go straight to the vendor — neither keys nor payloads ever touch our server.
- **Provenance records only events that affect the result** — the user's reading is free and never logged.
- Credential files (`*.key.json` etc.) must never be committed (see .gitignore).

## Conventions

- File-header comments cite the governing SPEC section (e.g. `SPEC §5.1.1`). Do the same when writing new contract/invariant code.
- Decisions and lessons are recorded in SPEC / experiment docs with absolute dates (never relative).
- Never use the terms harness / autoresearch / hill-climbing in user-facing screens — the product identity is a "control room", not a chatbot.
