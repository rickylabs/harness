# @rickylabs/governance

The tri-regime governance read: whether the system may spend, right now, as far as the configured
sources can tell. It reads the subscription, metered and capacity sources plus the recorded admissions,
composes them, and decodes the result through the published `GovernanceReadSnapshot` contract.

It reads; it does not refuse anything. Orchid owns live physical launch admission and accounting, and this
package is not its governor. Owned by **E5 · [#35](https://github.com/rickylabs/harness/issues/35)**;
moved out of `telemetry` by rearch(7) [#655](https://github.com/rickylabs/harness/issues/655).

## Layout

`mod.ts` is the only entry. The package depends on [`contracts`](../contracts/README.md) and nothing
else in the workspace; `tests/architecture/boundary.test.mjs` fails if it imports `@rickylabs/telemetry`
or any other workspace package, or if `src/domain` imports anything outward.

| Layer | Holds |
| --- | --- |
| `src/domain/` | The source descriptor types and value checks, and the pure usage, spend and capacity mappers |
| `src/application/` | `parseSource`, recorded admissions, transport availability, provider-limit snapshot decoding, `composeGovernance`, `collectGovernance`, `governanceRead`, `governanceAt` |
| `src/ports/` | `SourceServices`, `AdmissionLog`, `GovernanceWiring`: what a caller passes in |
| `src/adapters/` | The Node source services: bounded file reads, the usage-probe subprocess, the owner-only transport availability file, `readProviderLimitsFile` |

## What the caller wires in

The composition root (today `harness-telemetry`) supplies everything that is not governance's own. No
endpoint or host is named in this package: the operator's source descriptor names the spend endpoint
(`spend.url`, an exact `https` URL with no userinfo, query or fragment; the spend credential is sent there
and nowhere else) and the one host the usage probe may reach (`usage.allowNet`, a bare hostname).

- `GovernanceWiring`: the `producer` stamped on every document and the string `order` admissions sort by.
- `SourceServices`: environment, clock, usage probe, `fetch` and file readers. `defaultSourceServices()`
  is the Node implementation; tests pass fakes.

## Why there are three regimes

Quota windows, paid spend and physical capacity have incomparable units. Native transport labels do not
determine billing; an explicitly unmetered transport uses a configured static cap and never consumes
another vendor's meter. Missing source observations remain unknown. [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md)
is where that split is argued.

[`contracts`](../contracts/README.md) ships the shape, because the cockpits render it: `REGIMES` is
`subscription | metered | capacity`, `RegimeStatus` is a discriminated union, every regime carries
`observedAt`, an unread regime reports `allow` with `observedAt: null` and a note, and no regime is ever
omitted. Whatever this package cannot read, it says it could not read, rather than passing.

The commands, descriptor fields and failure behaviour are documented with the CLI that publishes them:
[telemetry governance reads](../telemetry/docs/governance.md).

## Provider-limit evidence

`readProviderLimitsFile(path)` reads one normalized provider-limit snapshot: an absolute, canonical
path to a same-UID `0600` regular file, never a link, opened without following links, at most the
contract's byte bound, and unchanged between the stat before and after the read. The bytes must be
valid UTF-8 and decode through `readProviderLimitSnapshot` from [`contracts`](../contracts/docs/workflows-and-providers.md#provider-limit-evidence-snapshot);
a snapshot generated in the future is refused. Every refusal is one fixed error that names no path.
It opens no credential and calls no provider API. The collector, the durable outcome ledger and the
admission decisions belong to the producer in
Orchid ([rickylabs/orchid#97](https://github.com/rickylabs/orchid/pull/97)), not to this package.
The `provider-limits` command that publishes it is documented in
[telemetry governance reads](../telemetry/docs/governance.md#provider-limit-snapshot-command).

---

Workspace conventions: [`packages/README.md`](../README.md).
