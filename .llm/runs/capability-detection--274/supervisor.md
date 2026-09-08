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
