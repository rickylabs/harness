# Local example receipts

Executed on Linux, Node 26.8.1 and pnpm 11.25.0 at baseline 7f6aed8. Frozen install and workspace compilation exited 0 first. All seven commands below exited 0. A unique temporary directory supplied separate profile and telemetry homes; it was removed afterwards. All four DSH_TELEMETRY_* path/rotation overrides were removed from each child environment. HOME and authentication configuration were not changed. No GitHub operation was performed.

Paths and trailing line whitespace are normalized below: the temporary profile home becomes /tmp/dsh-home, the temporary telemetry home becomes /tmp/tel-home, and the checkout becomes /path/to/harness. These are display placeholders, not the directories used. The profile dump excerpt is the final harness bundle section; earlier base-bundle output is intentionally omitted. Telemetry why retains its content but omits terminal blank lines in the fence. These receipts document this execution, not an automated future-drift gate.

## profile install — exit 0

```text
profile   rickylabs
surface   tui
directory /tmp/dsh-home/profiles/rickylabs
bundles   @deepseek-ai/dsh-base, @rickylabs/dsh-app
rows      harness-subagents, harness-board, harness-coordinator, harness-telemetry, harness-llm
link      node_modules/@rickylabs/dsh-app -> /path/to/harness/packages/dsh-app

wrote  package.json
wrote  pnpm-workspace.yaml
wrote  cordis.patch.yml
wrote  node_modules/@rickylabs/dsh-app

5 rows will be inserted. Verify with:
  dsh --profile rickylabs --dump-config
```

## profile dump — exit 0

```text
# == @rickylabs/dsh-app
- id: harness-subagents
  name: '@rickylabs/dsh-app/plugins/subagents'
- id: harness-board
  name: '@rickylabs/dsh-app/plugins/board'
- id: harness-coordinator
  name: '@rickylabs/dsh-app/plugins/coordinator'
- id: harness-telemetry
  name: '@rickylabs/dsh-app/plugins/telemetry'
- id: harness-llm
  name: '@rickylabs/dsh-app/plugins/llm'
```

## profile check — exit 0

```text
profile   rickylabs
surface   tui
directory /tmp/dsh-home/profiles/rickylabs
bundles   @deepseek-ai/dsh-base, @rickylabs/dsh-app
rows      harness-subagents, harness-board, harness-coordinator, harness-telemetry, harness-llm
link      node_modules/@rickylabs/dsh-app -> /path/to/harness/packages/dsh-app

installed and matching.
```

## telemetry where — exit 0

```text
telemetry is written here:

  live       /tmp/tel-home/observability/dsh-telemetry.jsonl
  rotated    4 generation(s) behind it, 32.0 MiB each
  cold tier  /tmp/tel-home/archives

a failing run is usually a layer below itself — look here, in this order:

  dispatcher capacity decisions
    the dispatcher's own log on the orchestrator host
    grep: no host with free capacity|operator timeout|deferring

  opencode relay log (OpenRouter and local-model calls), UTC
    ~/.local/state/opencode/log/opencode.log on ai-agents
    grep: run=<id>

  LM Studio application logs (model load and inference)
    /config/.lmstudio/server-logs/YYYY-MM/*.log, inside the lm-studio container
    grep: gpu|offload|n_ctx|Failed to load|abort

  host scheduler saturation
    the agent host itself: load average, and the process table
    grep: load average|D state
```

## telemetry record — exit 0

```text
recorded 2 event(s) to /tmp/tel-home/observability/dsh-telemetry.jsonl
```

## telemetry runs — exit 0

```text
2026-09-05T10:04:00Z  claude    complete claude-opus-5
```

## telemetry why — exit 0

```text
demo-1 (claude, complete) — look here, in this order:

  the run's own transcript
    /tmp/tel-home/observability/dsh-telemetry.jsonl

  dispatcher capacity decisions
    the dispatcher's own log on the orchestrator host
    grep: no host with free capacity|operator timeout|deferring
    why: a run that never appears is not a failed run; the dispatcher deferred it, and only its log says so
```


## Final displayed-command verification

Coordinator executed the final eight Step4/5 bash blocks literally under bash with errexit, nounset and pipefail. Seven CLI commands and cleanup all exited0. All four retained transcript fences match under the declared path substitutions, marked profile excerpt and trailing-whitespace trim. Both unique homes were absent after cleanup. No GitHub command ran.

Command-block SHA256: `8616f2acdcaa164eb51d2e4479020ca7356de80f755c0c1c9bccb3172dd843ab`.
