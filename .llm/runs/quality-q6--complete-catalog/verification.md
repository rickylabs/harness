# Complete OpenCode catalog verification

The approved metadata path passes native and synthetic controls. The producer, strict decoder and native version/source JSON must be consumed from the same reviewed revision.

| Gate | Result |
| --- | --- |
| RED before implementation against merged empty-variant fix | 15 controls: 1 pass, 14 assertion failures; both truncated and complete-record CLI prefix fail the complete-catalog requirement |
| Focused restored controls | 35 pass, 0 fail |
| Compiled guard mutations | 23 assertion-red mutants; restored compile and focused controls pass |
| `pnpm run typecheck` | exit 0 |
| `pnpm run build` | exit 0 |
| `pnpm test` | exit 0; 6 stages, 4131 pass, 0 fail |
| Added-line and complete-new-file leak scan | no operator paths, operational ports, tailnet addresses, credentials or native session identifiers |
| `git diff --check` | exit 0 |

The focused invocation is `node --test packages/routing/dist/discovery-opencode-http.test.js packages/routing/dist/discovery-native-default.test.js` after compiling routing. Mutations disable the verified route/version, provider shape/count/uniqueness, native body ID/provider equality, combined model count, nonempty catalog, variant version, root provenance, default/explicit byte bound, fatal UTF-8, both deadline checks, owned teardown and paired-reader source/root/version/catalog/model-origin checks. Every recorded mutant compiled and failed assertions; compile errors are not counted as kills.

The native Deno Node-compatible child-process control observed the complete verified HTTP catalog with no problems, matching independent complete metadata controls, and passed the strict snapshot reader. Native API parity checked exact model keys, body IDs, provider IDs and variants. Only metadata GETs were used; there was no model turn. Tests use sanitized model JSON and an owned synthetic ephemeral listener, with authenticated reads and process absence checks. Raw native output is never a committed fixture.

Repository gates used the supported Node 24 toolchain and an executable private child-process TMPDIR for existing shebang fixtures. This avoids the host's non-executable default temporary mount; no host mount or global environment was changed. Focused controls and native observation also passed on the development runtime.

Raw native metadata, event traces, buffer hashes and upstream issue draft remain private evidence, outside this patch. This establishes source and metadata behavior, not a live consumer rollout, authentication entitlement, quota, paid admission or inference readiness. Cockpit must accept the exact new API provider-source tag and pin the producer, paired reader and native JSON together before its coordinator-owned rollout.
