# @rickylabs/dsh-app

Our dsh profile and bundle (`cordis.patch.yml`) composing every plugin package.

Owned by epic E2 · #32. See [`packages/README.md`](../README.md) for workspace conventions.

## Why this exists

Every other package in this repository is a library with a CLI bolted on, which is a fine way to
build the pieces and no way at all to run them. This one is the place they become a running system:
a dsh profile that composes `@deepseek-ai/dsh-base` with our four services and our LLM adapter, and
a bundle that says which rows go onto the entry list.

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

Five rows, one `insert` with no `id`, so cordis appends them at the root of the entry list:

| row | claims | epic |
| --- | --- | --- |
| `harness-subagents` | `ctx.subagents` | E3 · #33 |
| `harness-board` | `ctx.harnessBoard` | E6 · #36 |
| `harness-coordinator` | `ctx.harnessCoordinator` | E6 · #36 |
| `harness-telemetry` | `ctx.harnessTelemetry` | E9 · #39 |
| `harness-llm` | nothing — registers on `ctx.llm` | E2 · #176 |

Nothing here addresses a base row. This bundle *adds* services; it does not reconfigure dsh's own,
because a patch that reaches into `@deepseek-ai/dsh-base`'s rows is a fork wearing a config file.

### The two seams stay apart

`ctx.subagents` and `ctx.llm` are separate services because they are separate resources —
[`docs/concepts/02-the-two-seams.md`](../../docs/concepts/02-the-two-seams.md) owns that argument.
What matters here is the composition consequence: **this package claims the first and leaves the
second to dsh.** `harness-llm` is not a walk-back of that. It provides no service and takes no key;
it injects `llm`, waits for dsh's runtime to mount, and calls `registerAdapter` for the three
token-metered destinations — so the meters stay separate while the routes become reachable. Base
URLs are configuration; `OPENROUTER_API_KEY` is not, and is read from the daemon's environment at
dispatch, because a profile is committed and a credential must not be.

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
--surface <s>    tui | web (default: tui)
--dry-run        with install: report what would change, write nothing
```

`--name` is there because a box that runs two deployments needs two profiles, not one that the
second install silently rewrites.

### Surfaces

A surface is *which dsh front end this profile composes*, and it is one line of the bundle list:

| surface | bundles | for |
| --- | --- | --- |
| `tui` (default) | `dsh-base`, ours | a terminal — dsh-base carries the TUI itself |
| `web` | `dsh-base`, `dsh-web-app`, ours | the container on the N5, browser on `:3080` |

Ours is always **last**, on both. Later layers win in cordis, so a surface bundle can never
reconfigure a row we own — a property worth a test rather than a convention, and it has one.

Neither surface adds a `dependencies` entry. `@deepseek-ai/dsh-web-app` is a direct dependency of
`@deepseek-ai/dsh`, and dsh resolves a bundle from its own install anchor before the profile's, so
naming it is enough. A profile that declared it would pin a second copy against the one already
installed — the same trap as declaring `dsh-base`.

`check` **infers** the surface when you do not name one. A `--surface web` install followed by a
bare `dsh-profile check` reports matching, not drift, because reporting the default as drift on a
correctly-installed web profile teaches an operator that the check lies. Naming one asserts it
instead: `check --surface tui` against a web install is drift, and exit 1 says which install
repairs it. An unknown name is exit 2 with the known ones listed, never a fallback to the default.

The deployment that uses this is [`deploy/`](../../deploy) — one compose file and one patch
overlay, with an acceptance test in [`src/deploy.test.ts`](./src/deploy.test.ts) that fails if the
stack drifts off the constraints that box actually imposes.

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
either side. Loading them all onto one context is the collision test, and it is worth running rather
than reading off four `CONTEXT_KEY` constants: the constants are what we chose, the context is what
cordis does with them. `harness-llm` has no key to read, so its two cases assert the other half of
the same property — that loading it registers its three routes exactly once, and that unloading the
fiber hands them back. A registration that outlived its fiber would fail the next load with
`DUPLICATE_ADAPTER` while leaving the new fiber with no routes at all.

## The golden snapshot

`cordis.patch.yml` states the rows *we* add. It says nothing about the eighty-five rows
`@deepseek-ai/dsh-base` puts underneath them — and those are the ones an upgrade moves. A release
that renames `session-log-deepseek`, drops `fs-sandbox`, or reorders the list so a service is claimed
after its first consumer changes what our plugins boot into, and every symptom of that arrives at
boot, on the box, at whatever hour the upgrade happened.

So the composed list is committed as [`dump-config.golden.yml`](./dump-config.golden.yml), and
`golden.test.ts` installs the profile into a throwaway `DSH_HOME`, runs the real binary, and compares
byte for byte. A dsh release that moves a row now fails a pull request. No new CI step was needed:
the repository's one workflow already runs `pnpm test` → `pnpm -r run test` → this package's
`node --test`, and a second place to declare the check is a second place to forget it.

### Why one file can be right on two operating systems

`--dump-config` **composes without booting and without evaluating `!!js`**. dsh-base's
environment-sensitive rows print as their unevaluated source text, so the output carries no absolute
path, no platform branch and no clock — it is a function of the lockfile alone. The snapshot contains
both `!!js process.platform === 'win32'` and `!!js process.platform !== 'win32'`, which is the
readable proof that neither branch was taken; a test asserts both are still there.

Two things could quietly end that, and both are closed rather than trusted: the capture runs against
a throwaway `DSH_HOME`, and it runs with **every `DSH_*` variable stripped** from the child
environment, so a future release cannot make the dump depend on a developer's shell without this
failing. A third test asserts the capture directory's own path never appears in the output.

### Re-blessing it

```bash
pnpm run golden:bless -- "what moved in the entry list, and why that is expected"
```

The reason is required, and it is written into the snapshot's own header — so the diff that changes
the rows carries the sentence explaining them, rather than leaving it to a commit message someone may
or may not write. The command prints rows before and after, the ids that appeared and disappeared,
and the dsh version either side: the paragraph the upgrade's pull request wants.

Regenerating is also the obvious way to launder a bad change, so two assertions survive it. The
snapshot must still **end with our own rows in bundle order**, and `@deepseek-ai/dsh-base`'s layer
must still compose **before** ours. A re-bless that reordered the bundles would match byte for byte
and still be wrong; these are what catch it.

Hand-editing the file is not a supported path and does not work: the row count in the header is
derived from the body by the renderer, so a header written by hand fails the round-trip assertion
even when every row in it is correct.

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
- **`harness-llm`** — `lmStudioUrl`, `llamaRocmUrl`, `openrouterUrl`, all defaulting to `""`, which
  means "use `@rickylabs/llm-local`'s backend table". Base URLs and nothing else. There is no
  credential key and there will not be one: the profile is committed, so `OPENROUTER_API_KEY` is
  read from the daemon's environment at dispatch, and a request that needs it and cannot find it is
  refused by name before a socket is opened.

### Board session projection

When dsh provides `ctx.sessionProjections`, `harness-board` also registers the strict
`harnessBoard` projection. The service's synchronous `refresh(session, input)` accepts a
caller-fetched GitHub issue cut and telemetry runs, derives the public milestone → epic → task →
child-run tree, and appends two adjacent whole-value events: `todo/write`, followed by
`harness/board-write`. GitHub remains authoritative. A model may replace its local todo list during
a turn, and the next refresh replaces that list from the next board snapshot.

`BoardRefreshInput.observations` optionally carries telemetry's typed governance view from the same
caller-owned evidence cut. The strict projection keeps its account windows, provider spend, local
capacity, and item-scoped refused admissions. Omitting it publishes explicit unavailable governance
rather than dropping the field or implying that every regime allows dispatch.

Refresh fails before either append when the projection registry or published `todos` projection is
absent, board-item normalization fails, or the strict public DTO rejects the result. The board
service itself still loads without either optional dsh capability, so profiles that only use the
pure projector keep working.

Run the executable integration smoke with no agent or model:

```bash
pnpm --filter @rickylabs/dsh-app run smoke:board-projection
```

It composes the published `SessionStore`, `SessionProjectionRegistry`, `ToolRuntime`, and
`dsh-tool-todo` plugin with `allowParallelInProgress: true`, loads `harness-board`, refreshes a live
session twice, checks todo authority, a parent/child run attachment, and explicit unavailable
governance, then verifies projection removal on plugin disposal. The focused composition test also
passes a fresh synthetic refusal through `refresh` and checks the published admission fields.

## Tests

Four tests are the ones that would have caught a real outage: the byte comparison
between `cordis.patch.yml` and `renderPatch()`, the check that every row names a published export
subpath, the disposal assertion above, and the golden snapshot — the only place in the repository
that looks at the rows dsh-base contributes.

`deploy.test.ts` is a fifth kind: it asserts against `deploy/`'s hand-written YAML as text rather
than generating it, because a compose file is read by an operator at 2am and its comments are half
of what it is for. Each check is a failure the N5 has actually produced — a `noexec` `TMPDIR`, a
compose key the MinisCloud editor drops without saying so, a published port with the container's
own loopback behind it.

`src/llm/` is tested by a different route again, and its shape is what makes that possible:
`transport.ts` is the only module that touches a socket, and it is a one-function parameter
everywhere else. So every step between a `GenerateOptions` and the `StreamChunk`s it produces —
refusal ordering, SSE framing, usage translation, a truncated body, a mid-stream reset — is asserted
against a canned exchange with no server running. One property runs through several of those cases
rather than living in one: a key planted in the credential reader reaches exactly one header and
appears in no chunk and no refusal message the adapter ever produces, on the success path and on
each failure path alike.

The CLI tests run `main()` against a fake filesystem with a failure switch, so the exit statuses
above are asserted rather than described — including the two that only show up when something is
wrong, `check` on a drifted managed file and `install` onto a home it cannot write.
