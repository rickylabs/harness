# Resume from the repaired producer

PR #777 continues the existing issue #776 branch. The repair covers honest coverage, partial-tree
compatibility, every prior facet, optional-socket fallback and documented rollout. Its extension
point is `packages/telemetry/docs/native-reads.md`; source ownership is in `plan.md`.

The separate supervisor reconciles the committed source and records exact gate/control evidence
before READY. No deployment, merge or redispatch is part of this change. The consumer is cockpit
PR #951, which supersedes the closed #954. Upstream Orchid PRs #133 and #134 must precede native rollout.

Accepted debt: missing native child/usage facets are tracked in Herdr #5725; native admission is
Orchid #136; indexed negative/replay coverage is Orchid #135. Until those sources exist, bounded
existing metadata readers remain. The fallback keeps its previous history bounds and does not
claim to deliver native restart recovery. The Herdr package move remains a nonblocking follow-up.

Final reconciliation against committed b6dda35e52c3474f5200f0a4e81bdd02985a5ded
returned PASS; see `review.md` for the substantive result and evidence.

A final protocol audit adds native recorded-token support for `codex-run` and `opencode-run`,
without changing public wire shapes. Prior sign-off remains historical evidence for its exact
source; the final reviewer records the token extension's committed source and gates before READY.

Token-extension sign-off against committed 4745909489faf1535a76d4e8ce773a9ea7922ec5
returned PASS with telemetry at 810 pass and 0 fail; see the final section of
`review.md` for the substantive result and evidence.
