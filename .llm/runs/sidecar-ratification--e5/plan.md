# sidecar-ratification--e5 — authorized execution manifest

The existing proposed ADR is the decision surface the owner ratified. This update records
that answer; it introduces no new architecture choice.

1. Mark ADR 0002 accepted, with its ratification date and a link to the approval comment.
2. Replace obsolete proposed-only wording with the accepted implementation scope.
3. Preserve the verb table, authentication, validation, no SSH fallback and resource limits.
4. Keep authority unavailable until the implementation exists and its gates are verified.
5. Obtain independent simple-tier review and green exact-head CI before merging the PR.

No owner fork remains in this record. Implementation, host deployment, production storage and
the first live canary are not delivered by ratification. The material risk is prose implying
that the service is deployed; review must verify that the authority table is unchanged and
that the implementation boundary remains explicit. No new runtime tests are needed for this
prose update. The repository build and normal CI tests remain required before merge.

[observed - https://github.com/rickylabs/harness/issues/62#issuecomment-5566218913;
topic: explicit owner approval and limits; retrieved 2026-09-07]
