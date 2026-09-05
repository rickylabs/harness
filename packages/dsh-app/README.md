# @rickylabs/dsh-app

Our dsh profile and bundle (`cordis.patch.yml`) composing every plugin package.

Owned by epic E2 · #32. See [`packages/README.md`](../README.md) for workspace conventions.

## Why this exists

Every other package in this repository is a library with a CLI bolted on, which is a fine way to
build the pieces and no way at all to run them. This one is the place they become a running system:
a dsh profile that composes `@deepseek-ai/dsh-base` with our four services, and a bundle that says
which rows go onto the entry list.

**We depend on published `@deepseek-ai/dsh`. There is no core fork** — decision 1 of #30. The only
fork in this project is `runzhliu/deepseek-harness-docker`, and it is not this. What that buys is
that a dsh release is an upgrade rather than a merge; what it costs is that everything we add has to
fit through the seams dsh already publishes, which is the constraint the rest of this package
answers to.

## The bundle

`cordis.patch.yml` is a **generated file**. `src/bundle.ts` holds the rows as typed data, renders
the YAML, and `bundle.test.ts` re-renders it and compares bytes — so an edit to the committed file
fails the test rather than reaching a daemon. Two failures move from boot time to test time that
way: a row naming a subpath the `exports` map does not publish, and two rows sharing an id.

Four rows, one `insert` with no `id`, so cordis appends them at the root of the entry list:

| row | service | epic |
| --- | --- | --- |
| `harness-subagents` | `ctx.subagents` | E3 · #33 |
| `harness-board` | `ctx.harnessBoard` | E6 · #36 |
| `harness-coordinator` | `ctx.harnessCoordinator` | E6 · #36 |
| `harness-telemetry` | `ctx.harnessTelemetry` | E9 · #39 |

Nothing here addresses a base row. This bundle *adds* services; it does not reconfigure dsh's own,
because a patch that reaches into `@deepseek-ai/dsh-base`'s rows is a fork wearing a config file.

### The two seams stay apart

`ctx.subagents` takes autonomous vendor CLIs and meters a **quota window**. `ctx.llm` takes an API
key and meters **per token**. They are separate services because they are separate resources, and
collapsing them into one abstraction is the design error the split exists to prevent
([`AGENTS.md`](../../AGENTS.md)). This package claims the first and leaves the second to dsh.

`harness-subagents` registers an **empty** registry and knows nothing about how providers will
attach — E3 owns that. Claiming the key early is not anticipation, it is a choice about the failure
mode: with the service present and empty, a dispatch reaches `selectProvider` and comes back with
`no-providers` and a sentence saying why. Without the row it reaches `ctx.subagents` and throws on
`undefined`, which reads as a broken daemon rather than an unconfigured one.

## `dsh-profile`

A dsh profile is four artefacts in `$DSH_HOME/profiles/<name>/`, and getting one of them subtly
wrong produces a daemon that boots and quietly does less. `dsh-profile` writes all four:

```bash
node packages/dsh-app/dist/cli.js install
dsh --profile rickylabs --dump-config
```

```
dsh-profile install         write the profile and link this bundle into it
dsh-profile check           exit non-zero when the installed profile has drifted
dsh-profile path            print the profile directory (for DSH_HOME scripting)

--home <dir>     dsh home (default: $DSH_HOME, else ~/.dsh)
--name <name>    profile name (default: rickylabs)
--dry-run        with install: report what would change, write nothing
```

`--name` is there because a box that runs two deployments needs two profiles, not one that the
second install silently rewrites.

### Managed, and seeded

Three files, and the distinction between them is the whole design:

| file | install | reason |
| --- | --- | --- |
| `package.json` | **managed** — rewritten to match | the bundle list is ours to state |
| `pnpm-workspace.yaml` | **managed** — rewritten to match | the linker mode is ours to state |
| `cordis.patch.yml` | **seeded** — written only if absent | this is the deployment's own layer |

The profile's `cordis.patch.yml` is where an operator turns a row off or re-configures one for *this
box*. An installer that owned it would revert that on the next run, and a `check` that reported it
as drift would teach the operator to ignore the check — which is the same as not having one. So
`install` writes it once and never again, and `check` stays silent about it forever.

The bundle reaches the profile as a **link**, not a dependency: `node_modules/@rickylabs/dsh-app`
points at this package directory. `@rickylabs/dsh-app` is `private: true` and unpublished, so there
is nothing to install; the link is refreshed on every `install`, which is what makes a profile
pointing at a stale checkout a one-command repair.

`@deepseek-ai/dsh-base` is *not* a dependency of the profile either. dsh resolves bundles from its
own install anchor first, and dsh-base ships with dsh — so declaring it would pin a second copy
against the one already there.

### Exit status

| status | meaning |
| --- | --- |
| 0 | installed and matching |
| 1 | the installed profile has drifted from this package |
| 2 | the command line was wrong |
| 3 | the profile directory could not be written |

1 and 3 are separated because they are different things to do about it: drift is fixed by
`dsh-profile install`, and an unwritable home is fixed by a person.

## What "it boots" means here

#32's acceptance is that `dsh --profile rickylabs --dump-config` shows our services claimed on
`ctx`, and that is two claims one command cannot make. `--dump-config` composes the layers and
prints them — it does not boot, and it does not evaluate the `!!js` expressions in dsh-base's own
rows. It proves the rows *will* load and nothing about whether they claim anything.

So the second half is a test. `plugins.test.ts` boots a real cordis `Context`, loads each plugin,
and asserts the service is readable at its key — **and gone again after the fiber unloads**, which
is the property that makes a patch reload safe. Two plugins that both survived disposal would
collide on the next load with `service "x" has been registered`, at boot, with no way to rename
either side. Loading all four onto one context is the collision test, and it is worth running rather
than reading off four `CONTEXT_KEY` constants: the constants are what we chose, the context is what
cordis does with them.

## Configuration

Each row takes its options from the profile's own patch layer, in the ordinary cordis way:

```yaml
- id: harness-board
  config:
    lanePrefix: topic
```

- **`harness-board`** — `lanePrefix` (default `lane`). The repository's actual prefix; `topic:` is
  the known divergence in `rickylabs/harness` itself.
- **`harness-coordinator`** — `policy`, one of `opposite-family` (default) or `seam-or-family`. An
  unknown name is a `RangeError` at boot, never a silent fallback: a deployment that misspells its
  evaluator policy must not quietly get the *other* one, because the whole point of the policy is
  that no implementation lane certifies its own work.
- **`harness-telemetry`** — `home` (default: this user's). `DSH_TELEMETRY_DIR` and friends are read
  once, at construction, so a snapshot taken after a rotation reads the directory the sink was
  writing to.

## Tests

70 tests. Three of them are the ones that would have caught a real outage: the byte comparison
between `cordis.patch.yml` and `renderPatch()`, the check that every row names a published export
subpath, and the disposal assertion above.

The CLI tests run `main()` against a fake filesystem with a failure switch, so the exit statuses
above are asserted rather than described — including the two that only show up when something is
wrong, `check` on a drifted managed file and `install` onto a home it cannot write.
