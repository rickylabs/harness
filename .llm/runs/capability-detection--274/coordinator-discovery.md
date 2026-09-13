# Capability detection precursor — issue274

Read-only source audit at Harness1d5df95 (routing source unchanged from9b120d2), 2026-09-08. No implementation or route-capability PASS.

Existing packages/routing/src/probe.ts is a pure consumer of caller observations. Its Observation identity is target+model; reachable/completed/output support a bounded metadata-fallback check. It does not identify effort, CLI version, account, subscription or launch binding. It does not perform discovery. Availability constants cannot authorize dispatch, and stale/incomplete observations fail closed. Reuse that discipline, not its identity as proof of exact physical capability.

packages/routing/src/admit.ts handles permission from configured lanes and effort declarations, not live quota/capability. Its comment states no socket/quota/file read. The configuration/invariant layers therefore cannot be substituted for provider observations. Physical effort support needs explicit schema support from272, followed by exact identity/provenance and safe detection in274; actual resolver use remains273.

Next research question within existing274: safe introspection adapters must report CLI presence/version, login, subscription entitlement, live allowance and exact model/effort capability independently, with unsupported introspection unknown. No auth-file inspection, provider integration or paid probe is authorized by this audit. One account/provider can serve both seams. An OpenRouter/Grok xhigh success gives no evidence for Muse max.

[source — packages/routing/src/probe.ts Observation/AvailabilityRequest/Verdict and module contract; topic: observation identity and unknown/freshness rules; inspected2026-09-08]
[source — packages/routing/src/admit.ts AdmissionContext and declared-effort admission; topic: configuration permission distinct from live ability; inspected2026-09-08]

## Existing bounded-execution and identity precedents

At b38d68a, telemetry's runUsageProbe uses shell:false, argument arrays, an explicit child
environment, ignored stderr, a stdout byte cap, timeout kill, close-based resolution and fixed
SourceError codes. Its tests exercise a real Node child for oversize, malformed JSON, nonzero
exit, timeout, missing binary and stderr-canary nonpublication. Reuse the proven constraints
in the design; this source audit does not claim the tests prove a future generic detector or
descendant-process isolation. A detector must separately specify what constitutes a successful
selected observation, rather than treating JSON plus exit0 as authenticated or entitled.

The repository-run reader's gitIdentity builds a restricted environment and passes argv without
a shell, with timeout/maxBuffer, avoiding inherited GIT configuration. Its bounded file reader
checks opened descriptor identity and path replacement. Detection needs an explicit identity and
replacement policy for CLI/version/account/source as well; whether it shares code or only the
mechanism should be decided by the plan, not by adding a cross-layer dependency for convenience.

[source — packages/telemetry/src/cli.ts:711 and cli.test.ts:956, bounded process capture and
existing real-child negative cases; inspected2026-09-08]
[source — packages/telemetry/src/repository-run-observation.ts:59 and :82, file replacement
checks and restricted git command environment; inspected2026-09-08]
