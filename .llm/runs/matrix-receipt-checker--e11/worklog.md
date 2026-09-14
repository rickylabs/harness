# Worklog

2026-09-14 — Locked the bounded I1 plan after independent PASS AFTER NARROW FIXES and explicit
admissibility reassessment. Started a separate implementation branch from 27d2ef3. Nine fixes
are included before product mutation; no additional owner permission or routing override needed.

Design checkpoint: public surface is a Node CLI and pnpm check stage; vocabulary is requested,
observed, known, unknown, pass/fail/unproven; ports are explicit files and stdout; closed constants
cover shape, reason codes and verdict codes only; one source/test/docs slice; deferred scope is
runtime dispatch and other invariants; contributor entry is docs/reference/matrix-receipts.md.

2026-09-14 — Implemented the closed receipt shape and CLI, semantic duplicate-key rejection,
fixed-index diagnostics and all three exits. Added the named root CI test stage and contributor
reference. Fourteen tests passed; bypassing the actual CLI call made two negative tests fail.
Typecheck and build passed. Full tests first reported the known scratch-executability limitation
as inconclusive, then all five stages passed using executable scratch. Independent source
review is next; no live dispatcher enforcement is claimed.
