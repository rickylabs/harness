# Anthropic compatibility delivery

The source fix is in [NetScript PR 2078](https://github.com/rickylabs/netscript/pull/2078). Harness contains the supervised delivery record; no product adapter is duplicated in this repository.

- Code commit: `51d8e10d5`, branch `fix/anthropic-forward-compatible-2063`, baseline `6f6cbdf030d7595d1730272d0a74aedd66225069`.
- Direct and registered Anthropic providers accept explicit instance-scoped `models`. Unknown unconfigured IDs remain refused; discovery/construction stay offline and unknown added IDs acquire no invented capability metadata.
- Exact Opus 5.5/Fable 5.1 request mapping retains mandatory adaptive thinking; Sonnet 5.5 `off` uses between_tools. Final merged options validate supported thinking, effort and tool semantics.
- The Messages stream regression caught SDK-internal placeholder client-tool retries; public `maxIterations(1)` restores the owned single-turn port.
- Baseline regression: two assertion failures. Fixed expanded regression: 10 passed. Whole AI/plugin suite: 201 passed/0 failed. Scoped check/lint/fmt: 142 files covered, no findings. Source quality gate: exit 0. Receipt files are retained alongside this record.
- Independent GLM 5.3 Flash evaluation is running in an isolated worktree; no generator certification claim. Generated-doc, dry-run and CLI E2E evidence are in progress.

Upstream [issue 2063](https://github.com/rickylabs/netscript/issues/2063) stays open for its dependent stable-publication and published-consumer acceptance. No stable package was published and no paid Anthropic inference was run. No independent remaining work to fan out.
