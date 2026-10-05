# Drift

## 2026-10-05 — upstream ownership

The inbox assignment is in Harness, but all product code belongs to NetScript. Keep Harness charter intact; implement in an isolated NetScript worktree and reference its upstream PR from this delivery PR. No unrelated package or picker changes.

## Release gate

NetScript 0.0.7 is already published and cannot be republished. The issue is scheduled for 0.0.8. Actual stable publication and released-consumer validation remain separate gates until a release exists; do not claim a source change unblocks the published consumer.

## Gate environment and evaluation correction

Validate Harness in an executable project worktree; keep the injected assignment out of repository docs checks. Source workspace graph is0.52.0/0.18.3, reportedconsumer0.52.3/0.18.3; both verified instead of conflating them. Generate docs with CI Deno2.9.5 and preserve required carrier changes upstream. Reviewer tool cwd initially violated checkout isolation; reuse the same primary GLM session to repeat proofs in detached checkout and publish its corrected report. Early draft policy requires subsequent evidence commits; published source history is retained.
