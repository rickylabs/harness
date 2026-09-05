# Worklog — pr-105-adversarial-review--review-claude

## 2026-09-05 UTC

- Read the operator assignment, repository `AGENTS.md` instructions supplied with the session,
  [`doctrine/WORKFLOW.md`](../../../doctrine/WORKFLOW.md), and
  [`doctrine/PRINCIPLES.md`](../../../doctrine/PRINCIPLES.md) before the first repository mutation.
- Checked issue #106 comments; no `orchid-triage` comment or existing implementation PR was present.
- The requested `agent-code-reviewer` skill was unavailable in the session skill catalog, so the
  explicit adversarial checklist and repository doctrine are the review procedure.
- No memory facility was exposed in this environment, so there were no prior session notes to
  consult or update.
- Fetched PR #105 head to the read-only local ref `origin/pr-105`; the reviewed branch has not been
  modified or pushed.
- Created an isolated detached worktree at PR head and installed the exact `pnpm@11.25.0` pin into
  an ephemeral tool prefix. Frozen install, graph check, root typecheck, root build, and all 116
  telemetry tests passed.
- Re-ran all 116 tests with `HOME=/definitely/not/a/real/home`; they still passed, confirming the
  suite does not depend on the invoking user's vendor stores.
- Exercised file sinks against a missing parent, directory target, mode-0444 file, read-only
  filesystem, `/dev/full`, BigInt, a cycle, `undefined`, an oversized record, and a throwing getter.
  The getter rejected at the caller and poisoned the queue; the other expected failures resolved
  into notes, while the oversized record knowingly breached the bound.
- Exercised tee sinks with a synchronous throw, rejected promise, and never-settling promise. The
  sync throw rejected and could prevent disk invocation; the hung leg kept the caller pending.
- Drove single-instance and 32-instance rotation. The single instance held its bound; independent
  instances produced 3,478 bytes under a 220-byte limit. Separate probes demonstrated silent loss
  after a failed generation rename and same-millisecond archive-name collisions.
- Fed both JSONL readers truncated JSON, truncated UTF-8, empty files, one byte, unknown records,
  primitives, and unexpected shapes. Valid JSON `null` crashed both parsers and the full backfill;
  a finite out-of-range Codex reset timestamp also threw. Tolerated truncation and unknown records
  produced no notes, and unknown timestamps advanced activity.
- Tested opencode against a missing database, empty/one-byte/non-SQLite files, and a real read-only
  database while a writer held a WAL transaction. Degraded files became notes; the reader saw only
  committed state and rejected a write.
- Hand-computed the mixed-seam total as 187 input, 28 output, 15 reasoning, and $1.25; `sumUsage`
  agreed. Confirmed Claude sums deltas, Codex takes the last running total, reset seconds and
  opencode milliseconds convert correctly, and absent counts remain distinct from zero.
- Demonstrated ambient-locale impurity: identical input ordered epic keys as `ä,z` under en-US and
  `z,ä` under sv-SE.
- Exercised every attribution string, notes/governance/no-items rendering, CLI exit cases, JSON,
  `--home`, `--limit`, and `--since`. Found ambiguous references choose the lowest item, SQLite
  ignores the limit, since is a post-read lexical filter, degraded inputs conflate with success,
  and `runs --json` drops notes.
- Used only synthetic privacy sentinels to show that human/JSON output retains user messages,
  titles, working directories, and store origins. No real transcript was read or published.
- Recorded verdict `FAIL_FIX` with ten findings and a per-box command/result disposition in
  [`adversarial-review.md`](adversarial-review.md).
- Published the same evidence as the single authorized review on PR #105:
  [`pullrequestreview-5119178703`](https://github.com/rickylabs/harness/pull/105#pullrequestreview-5119178703).
