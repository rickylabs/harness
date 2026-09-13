# Capability detection — supervisor

E11 step4, issue274, starts research and planning only. Dependency271 shipped. This step is
independent of schema272 and resolver273 at the declared DAG; do not silently make the pending
schema amendment a delivered dependency. No product mutation before independent plan PASS.

Baseline b38d68a (main; only board projection changed since9b120d2). Own branch
feat/274-capability-detection. The existing schema272 run is separately owner-gated for another
review round; it is not restarted or modified here. One existing Harness coordinator remains
responsible for all work. Planning uses the fresh architecture.plan CLI selection, with explicit
milestone-coordinator authorization because configurable local discovery, provider/account
boundaries and the published product interface are cross-package architecture.

Scope: generic CLI/version discovery, supported safe account/subscription metadata or explicit
unknown, per-model/family/account/version rules, provider ordering, exact capability observations
with provenance/freshness, and a versioned backend-facing configuration/detection boundary.
Preserve source identity and distinguish installed, logged-in, entitled, allowance and physical
model/effort support. No four provider integrations; no NetScript build dependency; no cockpit
implementation. Configuration is wholesale replaceable, and declared facts never become live proof.

Only this run's planning/evidence files may be authored. Product, tests, configuration, host
services, credentials, accounts, provider processes, sibling repositories and GitHub are read-only
for the planner. No paid probe or review dispatch. Raw operational evidence stays outside git.
Public files exclude operator paths, credential values and private consumer internals.

[owner — issue270/274, configuration boundary and independent step4 scope; consulted2026-09-08]
[observed — fresh matrix-plan.json at NetScript8eaa8c54, architecture plan route; executed2026-09-08]
[observed — b38d68a and diff9b120d2..b38d68a, board-only baseline advance; verified2026-09-08]

Native planner init: model `claude-fable-5-1`, session `f8cf8218-6f61-4f67-aa82-84c536ebd295`. Fresh CLI selected Fable5.1/xhigh on Claude Code; no substitute seat.

---

## 2026-09-13 — research session, resumed after the owner reset

The scope declared above still governs. This section records the second session against it, and
does not restate or amend the first; the 2026-09-08 entry stays as written because it is the record
of what that session was authorized to do.

Read first, in order: `ARCHITECTURE.md` v1 at `aa06a6c`, which is the locked charter and supersedes
the architecture in 30; then issue 274; then `AGENTS.md` and `doctrine/WORKFLOW.md`. The charter
advanced twice since the pause — decision 0003 locked it, decision 0004 corrected §10's park
evidence — and §10's corrected paragraph now carries the router-instance observation this run would
otherwise have re-derived, so it is cited rather than repeated.

Session identity: model `claude-opus-5`, as reported by the session's own system context, running
on the Claude Code CLI at 2.1.270. This is **not** a matrix candidate and was not selected by a
fresh matrix query — the operator brief assigned this session directly. Recorded as a deviation, in
the terms `.llm/runs/architecture-v1--smoke/receipt.md` uses, not smoothed over: requested route
unknown, observed `claude-opus-5` on the `claude` transport, effort `CLAUDE_EFFORT=high` observed
in the session environment and not verified as having been requested. A fresh
`deno task agentic:matrix -- --json` query was executed and retained as evidence per issue 274's
execution rules; it was used as the object of study, not as this session's seat authority.

Baseline `aa06a6c` (origin/main), NetScript source `155dbbe90`, branch
`research/274-capability-detection`.

**Mutation surface for this session: `.llm/runs/capability-detection--274/` only.** Specifically
`research.md` and `verification.md` created, and this file and `worklog.md` appended to. The six
artifacts the paused session committed to `feat/274-capability-detection` were brought forward
unmodified so the run directory is coherent on `main`; their content is not edited.

**Must not touch:** anything under `packages/`; no new package; no schema file; `ARCHITECTURE.md`,
`AGENTS.md`, `doctrine/` and `profiles/` are read-only (§13 routes disagreement through a numbered
decision, not a pull request); no sibling repository; no issue, label or milestone mutation beyond
the one pull request this run opens; the `harness` dispatch-trigger label is never applied.

**Why research and not code.** Issue 274's execution rules require research and an independent plan
evaluation before any product mutation, and `doctrine/WORKFLOW.md` Stage G forbids mutation until
`plan-eval.md` reads `PASS`. Independent evaluation has roughly 5.32 dollars of shared budget across
two repositories with a higher-priority gate queued ahead of it. Code that cannot be evaluated would
be waste. Research is the step that needs no evaluator, and it is the one the checkpoint recorded as
missing. `plan.md` is therefore deliberately absent, not forgotten.

**Evidence discipline this session held to.** Detection commands were read-only and free. No live
provider inference, no account change, no budget spent. One read-only usage GET against
`opencode.ai` was made; it spends nothing. No credential, token, cookie or account identifier was
printed or written — credential presence is reported by variable **name** and by file existence and
mode, and the three account identifier fields `claude auth status` returns were filtered at the
moment of capture. Epic E3 and UHP remain parked per §10 and nothing here proposes UHP work.
Extraction of the runtime out of netscript is not proposed, per §11.

[owner — deliver the RESEARCH deliverable for 274; research only, no product code, branch from
 origin/main; received 2026-09-13]
[observed — `ARCHITECTURE.md` v1 at `aa06a6c` with decisions 0003 and 0004; topic: locked charter,
 the corrected park evidence, and the amendment route; consulted 2026-09-13]
[observed — fresh `deno task agentic:matrix -- --json` at NetScript `155dbbe90`; topic: the export's
 exact shape as the object of study; executed 2026-09-13]
