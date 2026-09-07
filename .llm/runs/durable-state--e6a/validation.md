# durable-state--e6a — validation

**Clean-tree full validation passed** at `7f3077f14cadb535df00081087a1fd3b8c55d78c`, rebased onto main `1a0b4ef`. These are coordinator-executed results, separate from the author's focused tests and the evaluator's source review.

- `pnpm run build`: exit 0. All ten checks ran: graph, lifecycle, links, forms, snapshots, publish, label registry, generated docs, generated skill, tutorial. Publish check reported protocol 1, 67 tarball files and no tests. Tutorial check re-executed four marked blocks and reported three explicitly untested claims; no tutorial block changed in this PR.
- `pnpm -r run test`: exit 0; 2,604 tests passed across twelve packages, zero failed/cancelled/skipped/todo. Coordinator 299 and contracts 121 are included in that total.
- Store subset: 49 test results, including compile-time assertions and eight real SIGKILL cases. Required kill points are mid-checkpoint-temp-write, after file sync before rename, after rename before directory sync, and after a synthetic attempted effect before its receipt. The additional four cover ownership publication and first initialization.
- Independent implementation evaluation: PASS, no actionable findings, in implementation-eval.md.
- [GitHub CI for the reviewed head](https://github.com/rickylabs/harness/actions/runs/34083195460): typecheck, build and test passed.

## Final-head procedure

The final artifact commit preserves these observations without inventing a self-referential SHA. Before ready, the coordinator reruns the required commands from that clean final tree, obtains the same evaluator's confirmation at its exact head, and records the actual SHA/results in PR #247. The PR's ready status is withheld until that procedure completes.

## Limits

The tests kill owned child processes in mkdtemp directories. They do not prove power-loss durability, hardware-cache behavior, production-volume flush semantics, multi-host or shared/network storage safety, provider recovery, runtime dispatch, or end-to-end restart visibility. #191 owns those integration gates; F1 production store selection and F2 live rollout remain the owner's decisions. No deployment, package tag, canary or merge is performed by this run.
