# Plan — receipt-root-diagnostics--368

## Summary

Add observability around the existing root boundary: echo the configured root and classify only the six existing refusals. Preserve the acceptance set, diagnostics, dispatch parsing, and degraded semantics.

## Decisions

1. Use `root: string | undefined` and `reason: OrchidDispatchUnavailableReason | null`. This preserves the input exactly and gives healthy/unconfigured reads an explicit machine shape.
2. Use snake_case literals: `missing`, `not_directory`, `wrong_mode`, `relative_path`, `symlink`, `git_ancestor`, matching this module's existing diagnostic vocabulary.
3. Classify at each existing guard, while retaining a generic outer refusal with `reason: null` for I/O failures outside the closed vocabulary. Inventing a reason would be false; accepting the source would widen safety.
4. Keep `degraded` derived exactly from the existing notes set. Reasons do not participate in degradation.
5. The public surface in this issue is the exported reader result. The existing CLI aggregate continues to consume its dispatches/notes/degraded fields and does not gain a new JSON-envelope schema; the reader's direct caller can retain or surface the additive root diagnostics without parsing notes.
6. `missing` is assigned only when the root `lstat` returns `ENOENT`; other filesystem errors remain refused with a null reason. `relative_path` is checked before filesystem access; `symlink` covers a symbolic-link root or canonical-path mismatch; directory and mode use the existing `lstat`; `git_ancestor` is assigned only when an ancestor `.git` entry exists.

## Owner forks

None. The issue fixes the reason vocabulary and expressly forbids acceptance changes.

## Spikes

None. Filesystem classifications are covered by executable negative controls.

## Dependency DAG

Plan evaluation → reader/type/test/docs slice → scoped gate → mutation check → repository gates → independent implementation evaluation → PR.

## Risks and gates

- A reordered guard could change classification or acceptance: six defect controls plus one healthy control.
- A reason could accidentally alter degraded: every refusal asserts degraded and healthy asserts not degraded.
- A symlinked path component could slip through: retain canonical-path equality and test a symlink root.
- Additive fields could break caller inference: package typecheck and repository typecheck.
- Root reporting is the issue-directed exception to the old blanket diagnostic comment: it may echo only the operator-supplied root argument, never a reservation descriptor, receipt payload, pane, or native identity. The existing canary test remains a non-disclosure control.
- Mutation verification temporarily disables one classification guard, requires its dedicated test to exit nonzero, restores the source byte-for-byte, then reruns the scoped gate green. The healthy-empty control is part of the ordinary scoped gate, not a documentation mutation claim.

## Deferred scope

No dispatch JSON schema change, no acceptance relaxation, no new free-form I/O reason, and no change to entry-level `binding_unavailable` classification.
