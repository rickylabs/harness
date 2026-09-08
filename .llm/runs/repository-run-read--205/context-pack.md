Standalone repository/run read implementation is complete; synthetic gates PASS. Read
verification.md first, then verification-gates.json and verification-tests.json for exact results.
Candidate contracts0.3.0/protocol1. Full build/test/typecheck/check:publish/check:installed passed
with TMPDIR=/var/tmp; 2883 package tests and exact108-fixture run-observation matrix. Real-source
acceptance, independent implementation evaluation and any shipping actions remain coordinator-owned.

Governing plan is plan.md plus scope-amendment.md plus identifier-repair.md; plan-eval.md PASS
applies. The coordinator-added native-envelope-amendment.md and its plan-eval PASS (R2-R4)
are also implemented: strict full world_state cwd maps and dual-ID token_usage_record checks. Read drift.md for the bounded RepoRef validation gap and test-harness clarifications.
No new owner fork or auth/transport scope was introduced. CLI is run-observation --source followed
by one absolute local descriptor path; exact descriptor shape and exit semantics are in
verification.md and packages/telemetry/README.md. Public contracts export RepositoryRunObservation
and readRepositoryRunObservation. Source root and worktree are separate; original binding is
retained on detected changes, with no run payload. Backend owns enrollment/auth/revocation/fencing.

No real native store, credential file or private peer data was used. Tests generated synthetic
repositories/native files. No evaluator/sub-agent dispatch, workflows, sibling edits, board mutation,
remote Git actions or publication. Existing RunView/fold/hub/RemoteSnapshot and root lockfiles
unchanged. Launch routing remains local coordinator material; matrix snapshots are not committed.
