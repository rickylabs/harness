# Published governance read — resume pack

**CI repair is committed at `459afc6`; post-commit local gates passed. Same-session independent
repair review remains coordinator-owned.** Contracts 0.2.0 remains unpublished, protocol 1.
Task/run attribution: 2026-09-08. No live acceptance or #265 fix is claimed.

## History and current authority

Original product: `e6c14d9`; evidence: `8185ea6`. Independent implementation evaluation passed
source `8185ea6`, preserved by receipt commit `fe77c9e` in
[implementation-eval.md](implementation-eval.md). CI run `34170219400` on PR #278 then failed
build at check:snapshots and skipped tests. All seven governance JSON fixtures were now tracked
and contained observedAt. The original local build preceded tracking and omitted them through
git ls-files. That verification gap is corrected explicitly in [verification.md](verification.md).
Do not treat the old build receipt or old independent PASS as a repair-review receipt.

The coordinator authorized only the exact fixture inventory repair and isolated guard test, plus
root-script wiring/run evidence; see [drift.md](drift.md) D-9. No plan redesign, directory exemption,
magic marker, fixture rename/content change or workflow mutation. Reviewed plan authority remains
`01c523e894270700a8765d1bb0371cdaa7c0f1b8` with [plan-eval.md](plan-eval.md) BI-1–BI-10 and
[coordinator-amendment.md](coordinator-amendment.md).

## Repair and verification

The checker permits only the seven exact synthetic public contract fixture paths with their literal
SHA-256 byte digests. An inventoried file missing/unreadable/changed fails even if offending keys
were removed. Other files receive ordinary snapshot detection.
[source: ../../../scripts/check-snapshots.mjs:82,116]

`459afc6` was committed before full typecheck/build/test and standalone installed/snapshot/publish/
docs/diff/archive gates. All exited 0. Workspace tests: **2,878 passed**, including contracts 184 and
telemetry 431, no failures/skips/cancellations/todos. The **7 isolated snapshot guard tests** passed
through build and separately: exact fixtures pass; changed bytes, removed keys, missing fixture,
new same-directory snapshot, copied fixture elsewhere, and operator snapshot fail. The probe never
mutates the real git index. Real installed root/server runtime imports and consumer declaration
compilation, plus actual CLI synthetic timeout/kill/reap/admission fixture, passed.
[source: ../../../scripts/check-snapshots.test.mjs:14,42; verification.md (CI repair verification)]

Candidate tarball `rickylabs-harness-contracts-0.2.0.tgz` remains 73 files with unchanged SHA-256:
`cf3296949a8afbfabef7f6926d8ae732e831ec389453020c9fdd70bd07f27c1d`.
No contracts/telemetry behavior or fixture content changed during repair. Root/server protocol,
RemoteSnapshot/fold/hub/client/dsh-app remain as previously reviewed.

## Launch and handoff

[implementation-ci-repair-identity.json](implementation-ci-repair-identity.json) records the same
native thread, gpt-6-astra/openai/low, matched by the launcher before this turn.
[matrix-implementation-ci-repair.json](matrix-implementation-ci-repair.json) is the fresh feature
matrix. Private raw launch/CI logs were inspected but not copied into git; no operational paths or
credentials enter these receipts. No agents/evaluator dispatch or remote action occurred.

Use an owned executable TMPDIR for the installed fixture/root tests; the default temp filesystem
rejected executable files earlier. POSIX shebang support is required. No online install fallback.
The build's three declared untested tutorial blocks remain unverified. Public scanning is targeted,
not an exhaustive secret-proof claim. Existing Proxy limits and synthetic-only acceptance remain.

Coordinator sends the same evaluator session this repair for review and handles subsequent CI/PR
work. Owner alone tags/releases. This session performed no push, PR update, merge, board action,
tag or publication. See [verification.md](verification.md) for full repaired gate receipts.
