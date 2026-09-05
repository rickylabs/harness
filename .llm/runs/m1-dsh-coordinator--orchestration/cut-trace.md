# Cut Trace: M1 — dsh coordinator foundation

The audit trail from "what exists on the board" to "what this milestone committed to". Every
exclusion is here with its reason, so a later reader can tell a deliberate cut from an oversight.

| Field | Value |
| --- | --- |
| Milestone | `M1 — dsh coordinator foundation` (`rickylabs/harness` milestone `#1`) |
| Baseline | `b7d5e586e32f31ef44cab7b1327ab890f8e23794` |
| Frozen at | 2026-09-04 |
| Committed | 49 issues, `#40`–`#88` |

## Sources swept

All four intake sources were swept, as `milestone-intake.json` records:

| Source | Result |
| --- | --- |
| target milestone | 49 leaves — all included |
| unmilestoned | epics `#31`–`#39` and roadmap `#30` — all excluded, with reasons below |
| backlog | empty. This repository had four commits and no issue backlog before this programme. |
| later milestones | none exist. M1 is the first milestone in this repository. |

## Included

The 49 leaves, one per acceptance-bearing task under the nine epics. Each was filed from the
owner-ratified roadmap in `#30`, is PR-sized, and states its own acceptance criteria. They are
listed with their lanes and waves in `plan.md` and enumerated in `milestone-inventory.json`.

## Excluded, and why

| Issue(s) | Reason |
| --- | --- |
| `#31`–`#39` | Epic containers. Their scope enters M1 through their sub-issues, all of which are included. Milestoning the container as well would double-count the burn-down and make the milestone read 58 items for 49 units of work. They keep their sub-issue rollups, so they still show progress. |
| `#30` | The roadmap and decision record for the whole programme. It outlives M1 and closes when the roadmap does, not when this milestone cuts. |

No issue was excluded for capacity, and nothing was deferred to a later milestone — there is no
later milestone yet. Every unit of scope on the board at freeze time is committed.

## What could still make this freeze stale

The freeze is a claim about a moment. It stops being true if any of these happen without a
re-intake:

- An issue is closed, reopened, moved out of M1, or filed into M1.
- An epic is milestoned into M1 by a well-meaning hand, reintroducing the double-count.
- `main` advances, making `baselineMainSha` and `currentMainSha` disagree with reality.

Re-run the generator and the gate rather than hand-patching the artifacts. The generator asserts
that wave membership equals milestone membership and that every recorded edge crosses a wave
boundary, so a stale freeze fails loudly instead of validating against itself.
