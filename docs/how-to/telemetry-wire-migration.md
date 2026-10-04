# Migrate telemetry cost source names

Contract 0.36.0 adds canonical cost source names to the strict observation and grouped
issue-tree readers. It preserves legacy frames under schema and protocol 1. The public
package remains `@rickylabs/harness-contracts` with its existing exports.

| Cost row | Canonical source | Retained legacy source |
| --- | --- | --- |
| `subscriptionHeadroom` | `harness-telemetry.governance.usage` | `dsh-telemetry.governance.usage` |
| `meteredSpend` | `harness-telemetry.runs` | `dsh-telemetry.runs` |
| `runTokens` | `harness-telemetry.runs` | `dsh-telemetry.runs` |
| `localCapacity` | `harness-telemetry.host-capacity` | `dsh-telemetry.host-capacity` |

Readers accept either name independently for each available or unavailable row, including
mixed frames. They return the exact received name. A spend or token source cannot stand in
for quota or host capacity, and arbitrary identifiers or extra suffixes remain invalid.
`AGENT_COST_SOURCE_NAMES` exposes a deeply frozen per-row vocabulary; `AgentCostSource<K>`
gives each row its corresponding source union in the installed package declarations.

The change does not convert measurements or recompute totals. Kind, unit, scope, availability,
reason, revision, timestamp and freshness guards remain strict. A refused row rejects the
whole observation, including any valid prefix. Older three-row observations retain the
legacy unavailable capacity placeholder. Governance snapshots already accept bounded producer
identifiers; their reader needs no enum widening to admit `harness-telemetry`.

## Upgrade readers before producers

1. Merge the additive reader change after review and passing local and exact-head CI gates.
   Publish the reviewed contracts version using the release workflow, then verify its version
   and `gitHead` from the npm registry.
2. Upgrade the cockpit's installed decoder and each cost source schema to the same per-row
   unions. Preserve incoming source provenance. Regenerate OpenAPI and client validators using
   the product's normal build commands; capture their immutable provenance.
3. Upgrade each supported mobile client capture, lock and cache binding. Check canonical,
   legacy and mixed frames against the actual captured validators, including cross-class
   refusals. Record which reader/client versions are ready and which remain in service.
4. Switch producers only after that consumer readiness is established. Retain legacy reader
   aliases while supported clients or stored observations still need them. Roll back a
   producer switch before rolling back the readers that admit its output.

Version 0.36.0 implements the first reader step. Telemetry producers, `unavailableAgentCost()`,
and the missing-capacity fallback still use legacy names in this slice. Publication alone
is not evidence that cockpit or mobile accepts canonical output. Operator environment and
managed log files have a separate [migration guide](telemetry-operator-migration.md).

## Select canonical producer output

After the paired readers are ready, an operator can set
`HARNESS_TELEMETRY_WIRE_FAMILY=harness` for the producer process. It selects canonical names
for originated cost rows and the governance producer identifier. `issue-agents`, its watch
mode, `runs --json` agent observations and `governance` use the same selection. Pure producer
APIs also accept an optional `wireFamily`; no projector reads a mutable process environment.

An absent setting or exact `legacy` value retains existing output. Empty, padded or unknown
values are refused before source collection with a fixed diagnostic. There is no older alias
for this new setting. Readers and tree projection preserve source names received from other
producers, including mixed frames. No measurement, timestamp, reason, native binding or
accounting rule changes with the family.

Source support prepares the switch; it does not perform it. The default stays legacy until
supported cockpit and mobile validators have compatible cost source unions. Log filenames
have their own explicit selection and migration; changing wire family does not rename a log.
To roll back canonical wire output, select `legacy` before rolling back its readers.

## Verify the installed boundary

Run the repository's `typecheck`, `build` and `test` gates. `check:installed` packs and installs
the candidate contracts tarball offline and exercises all 16 source combinations for both
available and unavailable rows. It checks exact provenance and measurement round trips,
strict cross-class refusals, and valid/invalid TypeScript assignments against the installed
declarations. It also retains actual telemetry CLI compatibility checks for legacy producers.
A local tarball check establishes package compatibility; it does not publish or activate a
consumer.
