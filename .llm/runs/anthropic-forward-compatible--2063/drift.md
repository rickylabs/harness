# Drift

## 2026-10-05 — upstream ownership

The inbox assignment is in Harness, but all product code belongs to NetScript. Keep Harness charter intact; implement in an isolated NetScript worktree and reference its upstream PR from this delivery PR. No unrelated package or picker changes.

## Release gate

NetScript 0.0.7 is already published and cannot be republished. The issue is scheduled for 0.0.8. Actual stable publication and released-consumer validation remain separate gates until a release exists; do not claim a source change unblocks the published consumer.
