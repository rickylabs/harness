---
name: package-layout
description: >-
  The package shape rickylabs/harness is moving to, and how to move a package into it. Use this
  whenever you create a package, add a module to one, put a vendor or host integration somewhere, or
  move or rename a package — including providers/* and hosts/* moves. It covers mod.ts, the four
  layers, the import direction, and every file that must change when a package moves.
---

# Package layout

The target tree is in [`docs/STRUCTURE.md`](../../../docs/STRUCTURE.md), and the rules are golden rules
2, 8 and 10 in [`docs/DOCTRINE.md`](../../../docs/DOCTRINE.md).

## Shape of one package

    packages/<name>/
      package.json      name, bin, exports pointing at the built mod
      mod.ts            the only entry: re-exports the public API, nothing else
      src/domain/       pure types and rules; imports nothing outward
      src/application/  use cases; imports domain and ports
      src/ports/        interfaces the application needs from the world
      src/adapters/     vendor, host, filesystem and network code implementing ports
      tests/

- Another package imports this one only through `mod.ts`, never through a deep path.
- `domain` imports no adapter, no `node:` I/O and no other package except `packages/contracts`
  types.
- Compose behaviour by passing ports in; do not inherit.
- A shape shared across packages belongs in `packages/contracts`. Import it; do not re-parse it.
- No empty package: a package exists when it has code and a consumer.

## Where integrations go

- A vendor CLI or SDK (Claude, Codex, opencode, ACP) goes in `packages/providers/<vendor>`, as an
  adapter over the vendor's official programmatic surface (golden rule 1).
- A host (orchid, herdr) goes in `packages/hosts/<host>`.
- A model id never goes in code. The catalog comes from `packages/routing/config/*.json` and discovery.

## Moving a package

Change all of these in the same PR:

1. `git mv` the directory, so history follows it.
2. `pnpm-workspace.yaml`: make sure a glob covers the new location (for example `packages/providers/*`).
3. [`scripts/core-packages.mjs`](../../../scripts/core-packages.mjs): it scans `packages/<name>` and
   one group level, `packages/<group>/<name>` (as `packages/providers/*`), asserts the core count, and
   uses the `--filter=./packages/**` selector. A deeper location needs teaching; update the count, and
   keep `scripts/core-selection.test.mjs` passing.
4. The root `tsconfig.json` `references`, and the `references` of every package that depends on the
   moved one.
5. The package's own `package.json`, if its name or bin changes, and every dependent's dependency
   entry; then `pnpm install` so `pnpm-lock.yaml` follows.
6. If the package holds a consumer surface, the parity test and the table in `docs/STRUCTURE.md`
   (see the [parity-tests skill](../parity-tests/SKILL.md)).
7. A whole-repo `git grep` for the old path, excluding `.llm/runs`, with the empty result in the PR
   body (see the [prune skill](../prune/SKILL.md)).
