# Capability detection precursor — issue274

Read-only source audit at Harness1d5df95 (routing source unchanged from9b120d2), 2026-09-08. No implementation or route-capability PASS.

Existing packages/routing/src/probe.ts is a pure consumer of caller observations. Its Observation identity is target+model; reachable/completed/output support a bounded metadata-fallback check. It does not identify effort, CLI version, account, subscription or launch binding. It does not perform discovery. Availability constants cannot authorize dispatch, and stale/incomplete observations fail closed. Reuse that discipline, not its identity as proof of exact physical capability.

packages/routing/src/admit.ts handles permission from configured lanes and effort declarations, not live quota/capability. Its comment states no socket/quota/file read. The configuration/invariant layers therefore cannot be substituted for provider observations. Physical effort support needs explicit schema support from272, followed by exact identity/provenance and safe detection in274; actual resolver use remains273.

Next research question within existing274: safe introspection adapters must report CLI presence/version, login, subscription entitlement, live allowance and exact model/effort capability independently, with unsupported introspection unknown. No auth-file inspection, provider integration or paid probe is authorized by this audit. One account/provider can serve both seams. An OpenRouter/Grok xhigh success gives no evidence for Muse max.

[source — packages/routing/src/probe.ts Observation/AvailabilityRequest/Verdict and module contract; topic: observation identity and unknown/freshness rules; inspected2026-09-08]
[source — packages/routing/src/admit.ts AdmissionContext and declared-effort admission; topic: configuration permission distinct from live ability; inspected2026-09-08]
