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
| `src/application/` | `parseSource`, recorded admissions, transport availability, `composeGovernance`, `collectGovernance`, `governanceRead`, `governanceAt` |
| `src/ports/` | `SourceServices`, `AdmissionLog`, `GovernanceWiring`, `SourcePolicy`: what a caller passes in |
| `src/adapters/` | The Node source services: bounded file reads, the usage-probe subprocess, the owner-only transport availability file |

## What the caller wires in

The composition root (today `harness-telemetry`) supplies everything that is not governance's own:

- `GovernanceWiring`: the `producer` stamped on every document and the string `order` admissions sort by.
- `SourcePolicy`: the one spend endpoint a descriptor's `spend.url` may name. A descriptor that names any
  other URL is refused, so a spend credential is never sent elsewhere. No endpoint is named in this package.
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

---

Workspace conventions: [`packages/README.md`](../README.md).
