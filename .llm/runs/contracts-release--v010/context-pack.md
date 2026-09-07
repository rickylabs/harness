# Contracts v0.1.0 release handoff

READY FOR OWNER TAG PUSH. Publication has not happened.

Source marker: Harness release source and executable checks; topic: first public contracts artifact; date: 2026-09-07.

Package: `@rickylabs/harness-contracts@0.1.0`, protocol 1.
Release commit: `684840b61d4cbccec69f0ff015d2715941ca16b8`.
Last contracts change: `fa0456cefa7211094a747f0a9b924ae53835da18`.
Local annotated tag prepared (not pushed): `harness-contracts-v0.1.0`.

The existing release workflow passed its dry-run at the exact release commit:
https://github.com/rickylabs/harness/actions/runs/34105805648
This ran on Node 24. Publication and tag-only ancestry/version gates were skipped by design.
Locally, main ancestry passed and the manifest version matches the tag suffix;
local and remote tag absence was checked before creating the annotated local tag.
The public npm registry returned 404 for this version on 2026-09-07.

Local clean checkout: Node v26.8.1, pnpm 11.25.0, npm 11.19.0.
`pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build`, and `pnpm test` exited 0.
2,667 tests passed across 12 packages. The actual npm tarball was installed into
an isolated consumer; runtime root/server/package.json exports, protocol and package
identity, unknown versus failed, and a snapshot/fold round trip passed. TypeScript
consumer imports and a negative terminal-unknown settlement assertion passed.

Tarball: `rickylabs-harness-contracts-0.1.0.tgz`; 102,111 bytes, 67 entries, no test files.
SHA-256: `2c985e4eb20646b2c2f349ed9ee1fd04320ce8013ce60489f67232f332025a28`.
npm integrity: `sha512-6aYiqGI7gdEMbzxusfC3QpvkBVy0rAz/MKxFHshZ5ESZVar7FXB6QuxlwPkvONXk4PZwZDqWDtUQTZnPqlhUBg==`.
This hash identifies the local tarball, not an assertion about the future CI-built tarball.

Source/export locations: `packages/contracts/package.json` defines root, `/server`
and `/package.json` exports; TypeScript schemas are in `packages/contracts/src/`.
No product OpenAPI is emitted by Harness. The product backend must install this
version and produce its own captured OpenAPI and generated-client evidence.
A tag alone is insufficient: downstream integration starts after registry publication succeeds.

Known limits: exact provider queued state is not represented by RunView.outcome;
evidence freshness is a separate dimension. Reconnect freshness defect is tracked
in issue 265. Public stop, steer, receipt lookup, revision/coverage and grouping
semantics remain tracked in issues 259–263; creation capability is deferred in 264.
No downstream runtime integration, generated OpenAPI or native compatibility PASS
is claimed. Proposed v0.2.0 drafts are not this release.

NPM_TOKEN is configured (name inspected only). Its validity and npm scope publishing
permission remain UNKNOWN until the publishing job runs. Registry publication and
provenance verification remain UNKNOWN, not passed.

Owner action after checking the local annotated tag points to the pinned commit:

    git push origin refs/tags/harness-contracts-v0.1.0

That push triggers `.github/workflows/release-contracts.yml`, which checks ancestry
and version and invokes `npm publish --provenance --access public`. Do not invoke
manual non-dry-run workflow dispatch as an additional publication attempt. Do not
move or overwrite the release tag if publication fails; investigate the receipt.
After publication, inspect registry version, integrity and provenance, then give
the backend the installed version and source identity. Human merge of PR 266 is
a separate action; the release commit already exists on main.


Independent review: PASS, NetScript matrix simple / implementation_evaluation,
requested route `opencode-go/minimax-m3`, effort `provider_default`, session
`ses_f84c97506ffeWcJ2Ju72zzQTFf`. Reviewer checked documentation against source and
local receipts; did not independently execute tests or fetch CI. Provider/model
attestation beyond the requested launcher route remains unknown.

Fidelity fixture executed with synthetic historical timestamps: five execution
states can share the same fresh-evidence verdict; an old running claim is stalled;
missing evidence without a running claim is quiet. It also asserts that the wire
outcome omits queued and preserves unknown. This is not an adapter integration test.
Architecture/fidelity decision is recorded in PR 266 for human review.

This run changes release evidence only. No package version, protocol source,
workflow, protected owner issue or downstream repository is changed.
