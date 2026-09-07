# Contracts v0.1.0 release handoff

READY FOR HUMAN REVIEW. Merge PR 268 before preparing the final release tag.
No package publication has happened. The obsolete local tag was withdrawn.

Source marker: Harness source, npm tarball inspection and release workflow;
topic: first public contracts artifact with MIT licence; date: 2026-09-07.

Package: `@rickylabs/harness-contracts@0.1.0`, protocol 1.
Licensed package candidate: `88668ac564dc867e556bcae75d86c0ba47713ee4`.
This candidate is on the PR branch, not yet main. The owner must pin the resulting
merged main commit before creating `harness-contracts-v0.1.0`; a squash merge will
change its identity. The old candidate `684840b` lacked the package licence and
is superseded for publication. Its unpushed local tag was deleted, not moved.

## Executed checks

Corrected release rehearsal:
https://github.com/rickylabs/harness/actions/runs/34107640626
SUCCESS at exact candidate `88668ac564dc867e556bcae75d86c0ba47713ee4`.
Node 24, frozen install, typecheck, build, all 2,667 tests and npm pack dry-run passed.
Publication and tag-only ancestry/version gates were skipped because dryRun=true.
The older candidate's local frozen install/typecheck/build and 2,667 tests passed;
those historical results are not presented as a new local full-suite run.

Actual `npm pack` of the corrected package produced 68 entries including
`package/LICENSE`. Extracted licence bytes exactly match the repository-root
MIT licence. The actual tarball was installed into an isolated consumer;
installation, runtime exports/protocol/hub-fold round trip and TypeScript
consumer checks all exited 0. Local Node v26.8.1, pnpm 11.25.0, npm 11.19.0.

Tarball: `rickylabs-harness-contracts-0.1.0.tgz`; 102,820 bytes.
SHA-256: `866a3e3d998a3b1e28d74db6a9b4509d2e0b8e70f0f7b62082d2cf375f12479b`.
npm integrity: `sha512-5UCtJKDwEpqRa4jXkwguK7uEgWBIug7TBAFXfyaULkrZUoj/Z+STInXi35YVb1772k4udxWupFINznY2YT8d3w==`.
These identify the locally built tarball, not the future CI publication bytes.

## What remains

Npm publishing authentication is entirely UNREHEARSED. `npm pack` does not contact
the registry. NPM_TOKEN is configured by name, but its value, expiry, scope
ownership and publish permission were not tested. The registry audit returned
E404 for this package; no published artifact in the scope was established by this
run. Registry publication and provenance remain UNKNOWN, not passed.

A failed publication does not itself burn version 0.1.0. If npm never accepted
the upload, that version remains available. A workflow may fail after acceptance,
however: inspect registry state before retrying. Never overwrite a published version.

Human actions: merge PR 268; verify the resulting main commit includes the licence
and passes its required checks; create the annotated release tag at that commit;
then push only `refs/tags/harness-contracts-v0.1.0`. The existing release workflow
checks main ancestry/version and publishes with provenance. Do not additionally
run manual non-dry-run dispatch as a second publication attempt.

## Consumer boundary and known limits

Exports are root, `/server`, and `/package.json` in
`packages/contracts/package.json`; TypeScript schemas live under
`packages/contracts/src/`. No product OpenAPI is emitted by Harness. The product
backend must install the published version and supply its captured OpenAPI digest,
generated package identity/exports, and matching downstream native receipts.
Neither a diagram nor absence of adapter call sites proves compatibility or
no-schema impact. No downstream runtime/API/native PASS is claimed.

Exact provider queued state is not represented by RunView.outcome; evidence
freshness is independent. PR 266 records documented loss for v0.1.0. Issue 265
owns the reconnect freshness defect; proposed 0.2.0 remains draft/deferred.
Existing stop/steer/receipt/revision/grouping gaps remain in issues 259–263;
creation capability remains deferred in 264. No new research item was opened.

## Review and scope

The original handoff and architecture received independent MiniMax M3 review,
NetScript matrix simple / implementation_evaluation, requested
`opencode-go/minimax-m3`, effort `provider_default`, session
`ses_f84c97506ffeWcJ2Ju72zzQTFf`. The licence correction received a subsequent same-session PASS after independent
source/receipt inspection. Review is read-only; tests and CI
are coordinator-run evidence, not independently executed by that reviewer.
Provider/model attestation beyond requested route remains unknown.

This PR adds package licence text and release evidence only. No runtime protocol,
workflow, package version, protected owner issue or downstream source is changed.
