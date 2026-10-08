# Supervisor source sign-off — Harness644 contract and private reader (2026-10-08)

Verdict: PASS. Independent different-family Meta MuseSpark1.3/xhigh implementation review PASS (attempt2; attempt1 output-exhausted, UNPROVEN). This sign-off is a separate substantive read of the exact reviewed bytes, not a restatement: every product path in reviewed-product-source.json matched current SHA256 before commit (12 of 12), `git diff --check` clean, run records screened for credentials, native session IDs, private operational paths and real addresses (only loopback fixture URL and a fixture bearer token in integration scripts).

## Reviewed invariants (packages/contracts/src/provider-limits.ts, packages/telemetry/src/provider-limits.ts, provider-limits-cli.ts, cli.ts)

- Closed copying decoder: root/meter/outcome records require exact own-key counts, plain or null prototype, enumerable data properties only (accessors are refused without invocation); arrays require Array prototype, dense indices and bounded length (1024 rows, 256 routes). Accepted fields are copied, so later mutation of the input cannot change the decoded snapshot.
- Timestamps: calendar-valid UTC strings only (impossible dates such as 2026-02-30 are refused through round-trip comparison); meter observedAt and outcome observedAt never exceed generatedAt; the reader additionally refuses generatedAt in the future. Source times are copied verbatim, never refreshed.
- Scope and binding: subscription meters carry no keyName and may bind routes only with an accountRef and provider-prefixed routes; key meters are openrouter-only, model-less, with usd amounts and openrouter-prefixed routes, and an unnamed key is unknown with no routes. Duplicate meter identities are refused; a route bound by two different account/key identities is refused; separate native windows (5h/weekly) of one account may share a binding.
- State consistency: unknown rows carry no quantities and a reason; known rows carry no reason, a non-unavailable source and an observedAt; percent meters have usedPercent at most 100; usd meters reconcile used = limit - remaining within float tolerance. 100 percent is valid advisory evidence and never becomes an outcome.
- Outcomes: refused if and only if a reason is present; keyName only for openrouter; sources restricted to provider-run and inference-probe. The decoder never invents a refusal.
- Privacy: the whole decoded document is scanned for token shapes, bearer strings, tailscale names, dotted-quad addresses and home/temp/Windows paths and refused on match (fail closed, even for an exotic but legitimate model id).
- Private reader: absolute path equal to its realpath, O_NOFOLLOW|O_NONBLOCK open, regular file, same UID as the process, mode exactly 0600 (no setuid/setgid/sticky), size at most 4 MiB, read of size+1 must return exactly size bytes, pre/post fstat and lstat compare dev/ino/size/mtime/ctime/mode/uid so replacement or in-place change during the read is refused, fatal UTF-8 decode, contract decode. One fixed diagnostic; no path, environment or error detail leaks.
- CLI: `provider-limits --source <absolute file>` only; exit 0 with the complete valid JSON document, exit 2 for argument errors, exit 3 for an unavailable or unsafe source with no partial JSON. Dispatched before operator-environment resolution so no operator setting is read.
- Tests cover copy semantics, closed schema and secret refusal, duplicate identities, binding rules, accessor refusal, private file and CLI exit codes, 0644 refusal, symlink alias refusal, missing file and extra flag.

## Observations (non-blocking)

- The unsafe-pattern scan can refuse a legitimate model id that happens to contain a dotted quad or a path-like substring. This is fail-closed and consistent with the Orchid producer scan.
- Wire compatibility with Cockpit542 is proven by fixture integration in this run, not by a live deployment.

## Gate limitations preserved

- Harness typecheck/build/test full configured stages exit 0 on these exact bytes (validation.md). No package publication, no live host activation.
- Orchid privileged two-UID kernel gate (exit 127) and root owner-endpoint mutants (exit 1) remain UNPROVEN because sudo is absent on this host; the non-root subsets do not prove two-UID behavior.
- Live activation, production settings, restarts, secret stores, mobile645 and the canonical parent report are out of scope and unproven.
