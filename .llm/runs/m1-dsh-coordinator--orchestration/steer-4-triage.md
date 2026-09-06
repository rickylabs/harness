# Steer 4 triage and lane ordering

The owner explicitly prioritised #204 and the display half of #205, then E3 registration safety, then a dedicated public documentation lane. Three Sol medium planning sessions use the canonical straightforward plan cell; independent Opus 5 medium plan evaluations gate product edits. Existing source baseline is 9d800b54e447a600d8afab2ff90d07455b13a9c7; later board-only commits do not change the source evidence.

## E3 disposition

#208 is now E3/M1, assigned rickylabs at plan. Its missing milestone caused one board anomaly; assigning M1 restored zero anomalies. Choose wrapper provenance plus a named uninstrumented-provider refusal at selectProvider, rather than only a registration helper. The current method owns registry preflight (packages/subagents/src/provider.ts:262); the wrapper is structurally plain (packages/dsh-app/src/instrument.ts:252); createRegistry wraps an empty copy (plugins/subagents.ts:82). Put marker/check in the subagents contract without importing telemetry into that leaf; actual wrapping belongs to dsh-app. The detailed plan must state the in-process trust boundary, not pretend a marker proves sink durability or prevents hostile JS. Update plugin/instrument/bundle prose in the implementation and generate the patch. Review terminal seen-map cleanup without introducing repeated terminal emission (instrument.ts:260). This is a predecessor to E3 registration.

#206 is now E3/M1, assigned rickylabs at plan. Use RunLiveness for executor-reported state and LivenessVerdict for evidence-derived state. Keep both concepts; do not add a third vocabulary. Source: subagents/src/provider.ts:108 and telemetry/src/liveness.ts:70. #198 now coordinates the rename and widening with all providers; idle must be non-terminal and lease-holding, with explicit outcome mapping and ownership tests. provider-claude/src/run.ts:25 documents the missing idle cost. The TERMINAL array is not exhaustive by itself; tests must prove idle does not release ownership. Preserve the prior positive-evidence/ancestor-process checks.

Dependency placement follows the domain/application/adapter/composition split in eis-chat docs/rfcs/0004-modular-netscript-workspace.md:36 (read-only reference; Node+pnpm remains this repo's toolchain). Decisions and rationale are also posted on #208/#206/#198.

## Public documentation lane

Created #209 as a native E10 child of #140, topic:docs, p1, assigned rickylabs, with an explicit plan and independent gate. Run artifacts: ../public-docs-relaunch--e10/. README must explain the deterministic coordinator and human/agent split before installation, with code-backed status and a compact diagram. All inherited prose is evidence to check, not authority. #148 docs-site fork stays do-not-start. Netscript documentation supplies the requested quality bar; no Deno site/toolchain or cockpit is introduced here.

## Scope limits

#204 has no owner fork and can ship on engineering evidence. #205 display fixtures may ship now; production host wiring still requires #62. No partial display verdict closes #87 or #205. No harness trigger, contracts release tag, sibling worktree/session mutation, credentials or live operational snapshots are authorised by these tasks.
