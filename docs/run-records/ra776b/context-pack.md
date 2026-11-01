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

Coverage-repair sign-off against committed e0c7bd455625dc509e9c6fc28042508bf0c09fdf
returned PASS with telemetry at 811 pass and 0 fail; see the coverage-review
section of `review.md` for the substantive result and evidence.

## Coverage re-review supersedes earlier READY

The review at `44af55096` found unknown negative coverage and fixture-only replay inputs. The current
repair reports global `binding_unavailable`, keeps verified rows, removes unwired replay/attachment
inputs and their claims, and preserves admissions through Herdr failure. Read `coverage-review.md`
for the final gate and supervisor evidence. Orchid #133/#134 remain unchanged during coordinator
re-review. No production completion replay is claimed for this CLI.

Coverage repair local gates are complete: all five root commands exit 0, telemetry 811/811,
actual tagged 0.36 controls 5/5 and source-selection runtime revert 2 red then 2 green with exact
restoration. The committed-source review remains the final step before the new READY head.
