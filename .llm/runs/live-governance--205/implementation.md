# Live governance — implementation handback

Historical writer handback. See `verification.md` for coordinator repairs and later validation.

**S1–S5 implemented as an uncommitted, tested diff.** Telemetry: 412 passing tests; full workspace:
2,697 passing tests, zero skips. Root build passes. **Metadata comparison is unverified (exit 3),
not PASS. S6 live integration and independent evaluation were not run.** This is Part of #205;
finite-capacity and real item-admission acceptance remain unknown.

Base HEAD: `0e9998405e70bfb850bcff1adb7df22bca2a758d`. No commit or publication was performed.
[`implementation-surface.json`](implementation-surface.json) binds the exact 21-file product/test/docs
surface by SHA-256; run evidence is separate. The pre-existing untracked `matrix-implementation.json`
was left untouched and is not an implementation result from this session.

## Gate and scope

The independent PASS was read before product mutation (`plan-eval.md:3`). D24 governs over the earlier
shorthand. No agents or models were dispatched. The mutation surface stays within the plan's telemetry
files, generated CLI reference and run evidence. Contracts, governance stubs, routing, dsh-app product
code, dependencies, workflows, sibling repositories and GitHub were not changed.

The upstream usage library, credential resolver, endpoints and source validity module examined during
implementation were byte-identical to the corresponding files at the plan's upstream authority HEAD
`8ba53bc50ca02aab29e99ba5362728839b8f1713`. This was a local source comparison, not a live provider read.
The service/library boundary remains the one authorized in `plan.md` D24 and `plan-eval.md:8`.

## Implemented behavior and evidence

| Surface | Result and code evidence |
| --- | --- |
| Descriptor | Required explicit legs, bounded paths/model/labels/timing/output, exact current-key URL and fixed spend enum; closed refusal vocabulary. `packages/telemetry/src/source.ts:1`; tests `source.test.ts:1`. |
| Usage | Pure edge mapping, original capture time and transported source validity, configured durations, fixed seam/provenance, no binding inference or expense policy. `packages/telemetry/src/governance/usage.ts:5`; tests `usage.test.ts:1`. |
| Spend | Selected reported usage only; fixed OpenRouter provider/window label, no BYOK addition or inferred ceiling. `packages/telemetry/src/governance/spend.ts:4`; tests `spend.test.ts:1`. |
| Capacity | Configured cgroup-v2 scope, finite pair validation, unlimited total unknown with known used retained, GPU unknown. `packages/telemetry/src/governance/capacity.ts:11`; tests `capacity.test.ts:1`. |
| Admissions | Entire explicit detail validated by the shipped parser; required log runId; newest per item/regime, duplicate collapse, conflict/unorderable/malformed-newest safeguards. Fixed provenance, closed reason, private prose/approval payload withheld. `packages/telemetry/src/governance/admissions.ts:22`; tests `admissions.test.ts:1`. |
| Composition | Completion clock, source timestamps preserved, expired/future sources discarded, earliest retained expiry, successful-leg retention with incomplete requested-source status. All-unconfigured unavailable; pending approvals explicitly unobserved. `packages/telemetry/src/governance/compose.ts:16`; tests `compose.test.ts:1`. |
| CLI and transport | Source selection before source I/O; injected services; bounded spawn and streaming fetch; env-only probe; exact HTTPS URL, redirect refusal and body timeout; no live observation writes. `packages/telemetry/src/cli.ts:452`, `:627`, `:665`, `:715`. |
| Probe | External runtime imports via static aliases and an in-memory import map; imported validity bound; denied file dependencies; no model process. Deno file excluded by the unchanged src-only TS project. `packages/telemetry/adapters/opencode-usage-probe.ts:4`; launch vector `packages/telemetry/src/cli.ts:634`. |
| Display | Existing parser/projection retained; truthful partial capacity and stale leaf counts qualify the envelope badge. `packages/telemetry/src/render.ts:99`, `:121`; tests `render.test.ts:495`. |
| Compatibility and real CLI | File alias equals existing file mode, refresh follows changed inputs, immutable observations, all-unconfigured exit3, real writer-to-reader path, malformed newer admission cannot resurrect old refusal. `packages/telemetry/src/cli.test.ts:872`, `:892`, `:931`. |

Admission-only events are excluded from run lifecycle merging in live-source mode
(`packages/telemetry/src/cli.ts:494`): a log receipt is not an executed run. Arbitrary routing events and
prose never supply item identity. The closed ingestion reasons are documented in the telemetry README;
no E5 decision producer or dispatch policy was implemented.

## Actual validation commands and outcomes

The final validation batch used a temporary home in ignored git storage, neutralized ambient
`DSH_TELEMETRY_*`, and removed provider/API token bindings. CLI subprocess tests independently use
isolated temporary homes and minimized environments. Logs and synthetic launch scratch remain in
ignored git storage; no response, credential, operator path or operational reading is copied here.

| Actual command | Actual outcome |
| --- | --- |
| `pnpm --filter @rickylabs/telemetry typecheck` | Exit 0 on initial wiring and final product surface. |
| `pnpm --filter @rickylabs/telemetry test` | Initial 391-test run passed. Expanded suite initially failed compilation (TS2345 in a new render fixture); fixture corrected, then 411 passed. Calendar/ordering guard added, then 412 passed. Final real-CLI refresh/malformed-newest assertions also passed: 412 tests, zero skips. |
| `pnpm run docs:cli` | Exit 0; generated one changed page of six, only `docs/reference/cli/dsh-telemetry.md`. |
| `pnpm --filter @rickylabs/harness-contracts test` | Exit 0; 121 passed, zero skips. Contracts were not edited. |
| `pnpm --filter @rickylabs/dsh-app test` | Exit 0; 312 passed, zero skips. dsh-app was not edited. |
| `pnpm run build` | Exit 0 on final product code. Includes graph, lifecycle, local links, forms, snapshots, all package builds, publish-package checks, label registry, generated docs, generated skill and tutorial checks. |
| `pnpm run test` | Exit 0 on final product code; 2,697 tests passed, zero skips across twelve implemented package suites. The final subsequent changes only strengthened existing telemetry CLI test assertions, which passed in the targeted rerun above. |
| `pnpm run check:metadata` | Exit 3 under the credential-free isolated validation environment: no usable GitHub transport; nothing compared. The same result occurred in the validation rerun. No authenticated retry or authfile read was performed. |
| `git diff --check` | Exit 0 after implementation and tests. |
| `deno run --help` | Exit 0; inspected available runtime flags only. No service or network call. |
| `node --input-type=module` (stdin synthetic probe smoke) | Exit 0. Called the actual restricted Deno probe against a synthetic external module, with synthetic credential binding and no network request. Boolean assertions: probe executed; validity propagated; expected windows present; injected and Deno file reads denied. This is not S6. |

`check:links` is a local-link check; its successful root-build result does not claim external links were
fetched. `check:publish` is the existing package check, not publication. No skipped integration is
reported as a test pass.

## Remaining gates and coordinator next steps

1. Review the diff against `implementation-surface.json`; create a commit/publication only through the
   coordinator workflow. This session produced no push, PR, merge or tag.
2. Run the authenticated metadata comparison in the coordinator's authorized environment.
3. Run already-authorized S6 read-only integration using the configured operational checkout and
   env-only bindings. Gather refresh and scope receipts without private data in tracked artifacts.
4. Keep finite dispatch-scope capacity unknown unless actually observed, and item admission unknown
   until an authoritative gate has recorded a real item-scoped decision. Synthetic finite-memory and
   admission fixtures cannot close either criterion. Physical-host scope and pending approvals are
   unobserved by this reader.
5. Perform independent implementation evaluation at the resulting exact committed head, criterion
   by criterion. Publication may say **Part of #205**, with no full closure claim from these fixtures.
