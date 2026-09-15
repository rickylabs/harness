# Gate results

A gate that could not establish its result is **INCONCLUSIVE**, never green. Root `build`,
`typecheck` and `test` use `run-stages.mjs`; `check:stages` runs their controls first.

| Result | Exit | Meaning |
| --- | --- | --- |
| PASS | 0 | Every required observation completed successfully. |
| FAIL | 1 (or a native failure code) | An executed check established a defect. |
| INCONCLUSIVE | 2 | Execution, inventory or a complete observation was unavailable. |

The named compile stage speaks native compiler exit codes: TypeScript exit 2 becomes FAIL/1.
Other stages reserve exit 2 for the gate protocol. Add native compiler work as the designated
`--compile-stage`, not as a gate that claims to implement this protocol.

## Three boundaries

- **Installed contracts:** preflight executes a Node shebang in the actual scratch directory.
  A refusal reports the owned scratch `location`, a closed `execution` reason, and a remedy.
  It does not infer a noexec mount from every error or reflect arbitrary errors/child output.
  Windows is inconclusive before a shebang is attempted. `TMPDIR=/tmp pnpm run check:installed`
  can run fully when `/tmp` is executable and prerequisites are built.
- **Workspace test declarations:** `packages/*` is the inventory in `pnpm-workspace.yaml`.
  Missing/empty/unreadable inventory is inconclusive. Invalid JSON, undeclared missing test
  scripts, and stale/unreasoned exemptions are configuration failures. `DECLARED_UNCOVERED`
  names the explicit exemptions; a passing audit does not mean those packages were tested.
- **Stage aggregate:** summaries name the deciding stage, compile execution, and unreached
  stages. Empty/partial successful observations cannot pass. A runner that could not spawn
  is distinct from a runner that started but could not return a complete result. Shell
  126/127 and pnpm's structured ENOENT lifecycle errors indicate unavailable commands.
  pnpm's ndjson reporter preserves ENOENT when its exit code has already become 1; lifecycle
  and program output are forwarded, debug metadata is omitted. Captured stdout is bounded
  at 32 MiB; overflow is inconclusive. Output is forwarded at stage completion.

Signal and shell exit conventions remain ambiguous for programs deliberately choosing those
codes. The aggregate reports stage execution, not a per-package compiler census inside a
recursive stage; an unavailable command means completion of the compile is unproven.

## Extend and verify

Keep host capability errors separate from failed assertions. Add a negative control in
`gates-regressions.test.mjs` (or the existing gate test), then add its exact mutation in
`mutation-verify-gates.mjs`. The mutation command copies fixtures, establishes a green control,
changes one guard, and requires the named assertion to go red. It never changes the source tree.

    pnpm run check:stages
    pnpm run check:test-scripts
    pnpm run check:gate-mutations
    pnpm run typecheck
    pnpm run build
    TMPDIR=/tmp pnpm test

A noexec source checkout also prevents execution of pnpm's local binary shims. Run full success
checks in an executable checkout; use the noexec checkout as the refusal control. Record both
paths and results, rather than weakening the guards to make an unavailable environment green.
