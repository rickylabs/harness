# @rickylabs/host-orchid

The Orchid dispatch and evidence adapter. It reads Orchid's private receipt root (the configured
`matrix.receipt_root`) into contract shapes: dispatches, closed issue launch states, the private
native binding, stop and teardown observations and the Claude status Orchid relays from Herdr. It
writes nothing and starts no collector.

Moved out of `packages/telemetry` by #660. The receipt semantics, bounds and refusals are documented
once, in telemetry's [Orchid dispatch context](../../telemetry/docs/native-reads.md#orchid-dispatch-context).

## Boundary

- Depends on `@rickylabs/harness-contracts` only, through its published entry points. It never imports
  telemetry, which composes it. `tests/architecture/package-boundary.test.mjs` and
  `pnpm run check:graph` both refuse a telemetry edge (rule in `scripts/package-boundary.mjs`).
- `mod.ts` is the only entry. `orchidHost` is the implementation of telemetry's `OrchidReads` port
  (`packages/telemetry/src/host-reads.ts`); the named exports are the same functions.
- The shapes it returns (`DispatchEvidence`, `OrchidDispatchRead`, `OrchidLaunchState`) live in contracts.

## Layers

| Layer | Modules | Holds |
| --- | --- | --- |
| `src/domain` | `receipt-shape.ts` | pure receipt shape rules (object, exact keys, receipt time) |
| `src/application` | `native-binding-registry.ts`, `bind-dispatch-evidence.ts` | the private native join state and its queries; the log-evidence merge policy |
| `src/adapters` | `dispatch-reader.ts`, `native-binding-reader.ts`, `stop-observation.ts`, `teardown-observation.ts`, `claude-status.ts`, `private-json.ts` | bounded, owner-only, no-symlink file reads of the receipt root |

Tests of these readers live in `tests/`. Tests of telemetry's read models over this adapter's output
stay in telemetry (`packages/telemetry/src/host-orchid-*.test.ts`), so this package never imports telemetry.

```bash
pnpm --filter @rickylabs/host-orchid test
```
