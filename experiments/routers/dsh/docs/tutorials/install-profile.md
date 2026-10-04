# Install the optional router profile and inspect its composition

This is an opt-in static composition tutorial for the optional dsh router. Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm run experiment:dsh:build`. Core setup needs none of these steps. The checker uses a throwaway profile home and `--dump-config`; it does not launch a surface or send a model request. Actual experiment acceptance remains after the next APK under its separate task.

The [core board tutorial](../../../../../docs/tutorials/01-from-clone-to-board.md) uses the CLIs directly. The same code also loads into `dsh` as plugins, and the
profile is what registers them.

> [!NOTE]
> **Which output blocks are checked.** Every output block on this page carries a machine-readable
> `verify:` directive in an HTML comment above it, and `pnpm run check:tutorial:dsh` — part of
> `pnpm run experiment:dsh:check` — reads all of them. So each block is one of two things, and which one is never a
> matter of trust:
> 1. **Executed transcripts (normalized).** Re-run on every explicit experiment check and compared against what the
>    command above actually prints. Machine-specific paths are normalized to display placeholders
>    first: `/tmp/dsh-home` stands for `$PROFILE_HOME`, and
>    `/path/to/harness` for your checkout path — none of which are the real temporary paths. Where a
>    block shows only part of a long output it is marked as an excerpt, and the check requires those
>    lines to appear together and in order rather than to be the whole of it. Trailing whitespace and
>    terminal blank lines are trimmed on both sides of the comparison.
> 2. **Illustrative output (unexecuted).** Derived from source contracts rather than run here: live
>    GitHub responses, and the synthetic failures a healthy run never produces. The check prints this
>    list with its reasons on every run, so the boundary between what is proved and what is trusted
>    is something you can read rather than assume.

Create a unique temporary profile home directory with `mktemp -d` so nothing touches your real one:

```bash
PROFILE_HOME=$(mktemp -d)
node experiments/routers/dsh/dist/cli.js install --home "$PROFILE_HOME"
```

*(Executed transcript — normalized; see note above)*
<!-- verify: exact -->
```text
profile   rickylabs
surface   tui
directory /tmp/dsh-home/profiles/rickylabs
bundles   @deepseek-ai/dsh-base, @rickylabs/harness-router-dsh
rows      harness-subagents, harness-board, harness-coordinator, harness-telemetry, harness-routing, harness-llm
link      node_modules/@rickylabs/harness-router-dsh -> /path/to/harness/experiments/routers/dsh

wrote  package.json
wrote  pnpm-workspace.yaml
wrote  cordis.patch.yml
wrote  node_modules/@rickylabs/harness-router-dsh

6 rows will be inserted. Verify with:
  dsh --profile rickylabs --dump-config
```

Take it up on that. `dsh` is resolvable from the package that depends on it:

```bash
DSH_HOME="$PROFILE_HOME" \
  experiments/routers/dsh/node_modules/.bin/dsh --profile rickylabs --dump-config
```

The output is long — it is the entire plugin graph. The part you are looking for is at the very
bottom, after the whole base bundle (excerpted below to show only the appended bundle rows):

*(Executed excerpt — normalized, base bundle omitted; see note above)*
<!-- verify: contains -->
```text
# == @rickylabs/harness-router-dsh
- id: harness-subagents
  name: '@rickylabs/harness-router-dsh/plugins/subagents'
- id: harness-board
  name: '@rickylabs/harness-router-dsh/plugins/board'
- id: harness-coordinator
  name: '@rickylabs/harness-router-dsh/plugins/coordinator'
- id: harness-telemetry
  name: '@rickylabs/harness-router-dsh/plugins/telemetry'
- id: harness-routing
  name: '@rickylabs/harness-router-dsh/plugins/routing'
  config:
    document: '@rickylabs/routing/config/routing.v1.json'
- id: harness-llm
  name: '@rickylabs/harness-router-dsh/plugins/llm'
```

Six rows, appended after the base bundle rather than replacing anything in it. That is the profile
doing its one job. To confirm later that it is still installed and unmodified:

```bash
node experiments/routers/dsh/dist/cli.js check --home "$PROFILE_HOME"
```

which prints `installed and matching.` (preceded by the profile configuration summary) and exits `0`
(executed expectation, normalized; see note above).

**If it fails.** `check` exits non-zero when the installed profile has drifted from what this
repository would generate — usually because the working tree moved after `install` wrote the link.
Re-running `install` fixes it. This step does not boot a surface; booting one is a separate job with
its own prerequisites, and it belongs in a how-to rather than here.


Remove the throwaway home when finished:

```bash
rm -rf "$PROFILE_HOME"
```
