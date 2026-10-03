# Complete OpenCode catalog plan

The verified native HTTP catalog removes dependence on incomplete piped output. Retrying a malformed listing cannot establish completeness because truncation can also end after a valid model record.

## Root cause and source proof

Serial native metadata observations exited zero with empty stderr but incomplete stdout. Two captures were exact prefixes of a complete control, with stdout end preceding child close. Buffer copies were equal, and the parent had not reached its byte or timeout limits. Independent closed-stdin and ordinary pipe controls produced the complete output. A separate native HTTP metadata control returned the same complete model keys, body IDs, providers and variants.

- Immutable OpenCode source `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`: [models command](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/cli/cmd/models.ts) writes without awaiting stdout backpressure; [entry point](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/index.ts) forces exit in its finally block.
- [Native config handler](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts) uses the same `Provider.list()` as the CLI and public model projection; [route contract](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/server/routes/instance/httpapi/groups/config.ts) defines GET `/config/providers` behind authorization.
- [Node process documentation](https://nodejs.org/api/process.html#processexitcode) describes how forced exit can discard pending stdout writes. Native measurements establish this run's behavior; source and documentation explain it.

## Approved design

For the verified serializer, read the complete `/config/providers` JSON through the existing owned authenticated ephemeral loopback server. Read `/provider` for separate connection-presence facts on that same server. Both share one bounded metadata deadline; catalog body bytes retain the prior one-MiB limit. Keep authenticated address validation, no redirects, fatal UTF-8, duplicate-key/nesting checks and owned teardown.

Project exact native provider IDs and model map keys, require matching body IDs/provider IDs, retain variant semantics from #578, and reject malformed, empty or oversized catalogs. Publish API provenance rather than CLI provenance. Pair its strict reader with the producer: verified API version, root source, observed catalog and each model's API origin must agree. Unverified versions retain the legacy read; a verified API refusal never falls back to potentially incomplete stdout.

Model values remain JSON fixture data. These internal discovery source additions require the exact paired consumer pin; they do not add a public npm contract field. Connectivity never establishes payment, quota, capacity or owner authority.

## Gates

Before implementation, a successful truncated CLI and a successful complete-record prefix fail controls requiring the full catalog. Positive native HTTP and captured-model controls then pass. Negative API shape, binding, source, version, deadline, byte, authentication, redirect, UTF-8 and duplicate controls retain refusal. Compiled guard mutations must fail assertions, restored controls must pass, and required repository checks plus patch leak scan run before READY.
