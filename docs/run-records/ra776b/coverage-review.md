# Coverage re-review repair

The CHANGES review at `44af55096fc2d040f05e418e6c8da59e8a153deb` found false negative
coverage and replay guarantees backed only by fixtures. This record supersedes those earlier claims.

A healthy native source with empty or partial Herdr labels now reports global incomplete coverage
with `binding_unavailable` until Orchid #135 supplies a covered active set or replay. Selected
positive issue rows retain their complete data, while real overflow remains `scan_limit` and
partial-tree opt-in is unchanged. Run-bundle and binding coverage are likewise incomplete.

The unused replay and attachment inputs and their fixture-only claims are removed. This CLI has no
persisted coordinates: after a workspace label disappears, it cannot report that run's later
completion. Cockpit #951 owns a separate observer/checkpoint and does not call this collector.
Native completion while a label remains discoverable is still covered for all vendor forms.

Herdr snapshot acquisition now occurs inside the native collector's failure boundary. The real CLI
preserves independent refusals and blocks when that command fails. Snapshot combination explicitly
carries block evidence even when no execution row is available.

The new empty/partial census and CLI failure tests compiled against the previous production source
(exit 0), then all four failed at runtime (exit 1). After repair all 23 focused native tests pass.
The stale-stop test now proves the real previous producer sees the paired historical stop as ended,
then proves current native working evidence wins; it no longer uses an attachment callback.

## Verification

- `pnpm install --frozen-lockfile` — exit 0, lockfile up to date.
- `pnpm run typecheck` — exit 0, 5 stages green; compile ran.
- `pnpm run build` — exit 0, 15 stages green; compile and repository checks ran.
- `pnpm test` — exit 0, 8 stages green; telemetry 811 pass, 0 fail.
- `pnpm run check:leaks` — exit 0. The committed-head scan is repeated before push.
- New coverage/admission controls: build exit 0, four runtime failures against prior production;
  repaired focused suite 23 pass, 0 fail.
- Tagged 0.36 decoder: 5 real producer controls pass, including empty/partial census,
  complete selected rows, overflow and facets. Explicit bounded opt-in is still rejected by the
  older decoder and accepted by the current decoder; default overflow rows remain compatible.
- Source-selection revert: previous production collector compiles (exit 0), both required
  restart/history tests fail at runtime (exit 1), exact-byte restoration compiles (exit 0),
  then both pass (exit 0).
- Removed-input whole-repository search, excluding owner-controlled runs: exit 1, zero matches.

No contract, limit, dependency, live service or Orchid source is changed. Independent review and
supervisor sign-off reconcile the committed source before READY.
