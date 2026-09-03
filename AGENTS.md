# AGENTS.md

Guidance for coding agents working in this repository. `CLAUDE.md` loads this file through `@AGENTS.md`; keep the guidance tool-agnostic.

## Project and sources of truth

**Harnest** is a web control room that freezes a judging procedure after user validation and approval, then iteratively improves an artifact against that procedure.

- Current product policy and invariants: `SPEC.md`
- Exact fields, types, and execution contracts: `packages/contracts` and their tests
- Design rationale: `PHILOSOPHY.md`
- Unimplemented or deferred scope: `ROADMAP.md`
- Empirical evidence: `experiments/`
- Explanatory material (code-derived loop walkthrough, user scenario, terminology reference): `docs/` — descriptive, not normative

Drafts and archived documents (`docs/archive/`) are not current contracts. Before changing an invariant, inspect the relevant SPEC section and contract tests.

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
apps/web              React SPA with mock, OpenAI, Gemini, Vertex AI, Claude, OpenRouter, and Ollama clients
apps/api              Optional FastAPI + SQLite persistence API, plus the admin shared-key proxy (`/proxy/*`)
experiments           Frozen protocols, measurement code, and results
```

The dependency direction is `contracts` ← `loop-engine` / `templates/*` ← `apps/web`. The web app composes template-specific behavior through the `TemplateEntry` boundary.

## Core guardrails

- `definitionDigest` is the SHA-256 of `digestScope()`. Its scope includes all of `packVersion`, `templateId`, `criteria`, `gates`, `judgeProcedure`, and `holdoutPolicy`; changing any of them requires re-approval.
- Do not resume a checkpoint when its `packDigest` differs from the current `definitionDigest`.
- The engine does not mutate the supplied pack or scorer. Only candidates that pass the gates enter the adoption decision. When the pack configures a validation guard (`holdoutPolicy.mode: "seeded_split"`), a candidate whose guard aggregate drops more than `guardTolerance` below the champion's is rejected regardless of its scalar. On top of that, adoption requires a **strict scalar score improvement**: ties keep the existing champion, so the champion curve never declines (the guard curve may drop within the tolerance).
- Score the holdout only at round 0 and at the end. Do not use holdout questions or scores for generation, adoption, or stopping decisions. The validation guard is scored every round, but only its aggregate feeds the adoption decision — its per-case questions and traces must never reach the Generator.
- Examiner reports bind to the judging procedure through `forDigest`, not from inside the pack. Revising the criteria changes the digest, mechanically invalidates the previous report, and the approval screen re-runs validation automatically (auto-start at most once per digest, tracked in project state so leaving the screen does not restart it; further runs are user-initiated). The battery checks only what varies per run — the chosen judge model (stability; fabrication, sycophancy, and instruction-injection resistance); deterministic code is covered by unit tests, and arithmetic properties of the configuration surface as compile-time notices. Stability thresholds are derived from the sample size (one rung = half a grading step = `100 / (2 × cases)`, rounded up to one decimal — the same formula as `guardTolerance`), never absolute points.
- Deterministic-only templates are exempt from examiner validation, and the UI must disclose that exemption.
- A blocked strategy key is a diversity heuristic, not an invariant. Never abort a run for it: the engine re-plans once and then generates without a strategy; the handover planner substitutes the first unblocked strategy after its single format retry. Only genuine format errors fail the round (paused at the previous round boundary, nothing recorded).
- Never score a truncated or failed model output as a finished artifact — vendor truncation/failure signals are errors on both streaming and non-streaming paths. Stop/finish reasons are judged by allowlist (only the vendor's normal-completion values pass; context-window truncation, content filters, and unknown reasons are errors even with text), and a stream is complete only after the vendor's completion signal — a body that closes without one is a partial artifact. Streaming has no absolute deadline, only an idle timeout. Fall back to non-streaming (with backoff retries) only when no response was received at all or the vendor rejected the request without processing it (429·5xx — re-sending cannot double-bill); never re-send a request the vendor may already have accepted (any failure or truncation after the stream started, partial output received, a non-streaming request timeout, shared-proxy 504 or network drop). Other rejections (400·401·403·404) return the same answer on retry and are surfaced as errors without re-sending.
- Do not add template-specific branches to pages or the engine. Keep trust boundaries and composition responsibilities in the template registration interface.
- Store BYO API keys only in browser `localStorage`. Send model request bodies directly from the browser to the selected vendor, not through the Harnest server. There are exactly two user-chosen exceptions: project and result data the user explicitly persists, and the admin shared-key proxy (`/proxy/*`, SPEC §7.1), used only when the user leaves the key empty on a deployment that sets `SHARED_*_API_KEY`. The proxy forwards the body without storing it and enforces only transport-level limits (model allowlist, output-token cap, per-IP rate limit, body size/format/origin checks, and a non-streaming upstream call with a read timeout proportional to the output cap); it never touches evaluation semantics, and the UI must disclose the server hop at the point of use.
- One tab per browser owns the project: the tab holding the Web Lock writes the snapshot and checkpoints; other tabs are read-only (no save, approve, start, or resume) and must say so. Where Web Locks are unavailable (non-secure context, older browsers) a `localStorage` lease with heartbeat and read-back takes its place — never treat lock failure as ownership, since checkpoints have no CAS and two owners can resume the same run. Runs belong to the project, not the console route — navigating away never pauses a run.
- Never commit credential files such as `*.key.json` or raw API keys.

## Contribution conventions

- Use Korean by default for user-facing UI, core project documentation, code comments, and commit messages. Keep this agent guidance in English. Do not force translations of identifiers, API or library names, standard technical terms, or externally established terminology; clarity takes priority.
- Update SPEC only when policy or an invariant changes. Put future work in ROADMAP, empirical observations in `experiments`, and ordinary implementation history in Git. Avoid duplicating the same content across documents.
- Cite SPEC sections only in code or tests that directly implement a non-obvious invariant. File-header citations are not mandatory everywhere.
- Do not rewrite frozen experiment protocols or raw observations as part of cleanup. If a correction is necessary, append a correction record with a reason and an absolute date.
- Keep the user-facing product framing centered on a control room. Explain internal algorithm terms only when they help the user understand the behavior.
