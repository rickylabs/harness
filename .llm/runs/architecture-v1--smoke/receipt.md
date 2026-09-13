# Dispatch receipt — architecture-v1--smoke

Issue #304. The first end-to-end smoke of the dispatch contract in `ARCHITECTURE.md` §5.

**Requested** is what the issue brief asked for. **Observed** is what this session can state about
itself. Where the two differ, both are shown. A value this session cannot know is `unknown`; a value
it could only state by exposing a host, path, session or credential is `withheld`.

| Field | Requested | Observed |
| --- | --- | --- |
| model | matrix `implementation` row, tier `simple`: `luna` (max effort), then `qwen_3_8_flash_next`. The brief records that neither was taken and the default transport was used instead. | `claude-opus-5`, as reported by the session's own system context. Not a matrix candidate. Not independently verified by a launcher receipt. |
| effort | `max` for the first matrix candidate; the brief records that effort was **not passed** | unknown — no effort argument is visible to this session |
| transport | "the default transport" (brief prose); the issue's override line reads `harness: claude` | Claude Code CLI, as reported by the session's own system context |
| role | implementation | implementation |
| tier | simple | simple |
| profile | `leaf` | `leaf` |
| `profiles/leaf.md` present and read | — | yes — present at the repository root and read before any file was written |

## Deviations, recorded not hidden

- **Model.** Not resolved from the matrix. No mapping exists from a matrix model id to a dispatcher
  transport (`ARCHITECTURE.md` §11 step 2). This is the deviation invariant I1 exists to surface.
- **Effort.** Not applied as an argument on this transport (`ARCHITECTURE.md` §5, known gap).
- **Profile obligations not carried out.** `profiles/leaf.md` requires matrix resolution, a
  `supervisor.md`/`worklog.md`/`context-pack.md` run directory, a gate, and a cross-vendor
  implementation evaluation. The brief restricts this run to exactly two files, and operator
  scope wins; none of those were produced. No evaluator ran, so nothing here is evaluated — it is
  unevaluated, not passed.
- **Gate.** The change is two markdown files. No gate was run against it: unproven.
