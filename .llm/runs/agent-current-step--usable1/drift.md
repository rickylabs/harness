# Drift

- Recent local transcript samples contained no `update_plan` or `TodoWrite` tool call to use as a live fixture. Used official Codex schema and Claude Code's published tool shape, plus strict synthetic parser tests. Live behavior remains a separate proof.
- The existing issue tree does not add a new `currentStep` field; the newest `activity.steps` row is the current displayed action, and plan updates contribute a screened message row when emitted.
