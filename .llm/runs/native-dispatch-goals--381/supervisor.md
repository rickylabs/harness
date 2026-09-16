# Native dispatch goals — implementation and live gate

Status: implementation tested locally; live dispatch proof pending. Tracking: [Harness #381](https://github.com/rickylabs/harness/issues/381).

Author: gpt-6-astra. Native identities and operator environment are deliberately omitted. Work is in an owned Harness worktree and fresh Orchid clone, never the stale shared build.

Evidence snapshot: Harness `13aa853bf46acc0f879dfaeaa827f0c3cbd4bbad`; Orchid `78899f493a36431690f897478d588b0aa6f6e82e`; NetScript `f3324909e0896cedc9729005bac5f508e122d6c6`; installed Codex `0.154.0`.

Mutation surface: Orchid dispatch hook, separate native goal transport, lifecycle integration, tests, RFC and evidence. Harness product code is unchanged. Owner authorization covers the eventual dispatcher-only restart and new real dispatch. Missing deployment connectivity is an execution limitation, not a permission fork.

No live configuration, restart, receipt write, labelled issue or native goal mutation has occurred. No implementation PR is opened before the required live proof. See context-pack.md for current gates and the Orchid run directory for exact command receipts.

Published Orchid branch: `fix/381-native-dispatch-goals`, head `ccb85ba6055834a2fc1ec8300668d1e00e4b7701`. Whole-branch publication scan passes after commit. PR remains unopened pending the real-dispatch proof.

## Coordinator checkpoint instruction

Stop deployment attempts: host isolation is intentional. Commit and push all work, open the Orchid PR with live verdict INCONCLUSIVE (`deployment-connection-unavailable`), and hand the deployment and dispatch proof to the operator. This supersedes earlier requests for a connection and the pre-PR live gate. See checkpoint.md.
