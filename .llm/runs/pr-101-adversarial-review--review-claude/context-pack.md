# Context pack — pr-101-adversarial-review--review-claude

## Outcome

**Complete with verdict `FAIL_FIX`.** PR #101 cannot pass adversarial review at head
[`ad8ce70`](https://github.com/rickylabs/harness/commit/ad8ce70ebb4bc766b29929da825d095057265880).

Six corrections are required:

1. Make the published `/swarm` reader and writer behavior-identical to divybot, especially at the
   key/prompt boundary, duplicates, fences, aliases, accepted harnesses, timeouts, and token values.
2. Use the adapter's `merged` fact so a closed, unmerged PR cannot roll up as shipped without an
   anomaly.
3. Detect ambiguous epic identity and milestone ownership instead of dropping one colliding epic or
   rendering one epic issue under two milestones.
4. Replace locale-sensitive hierarchy ordering with a specified, locale-independent total order.
5. Represent fetch completeness and make every rendered view disclose or reject truncation.
6. Map network/transport failures to the documented transport exit code instead of the anomaly code.

Independent passing controls include the exact pinned build/typecheck, all 81 package tests, a
byte-identical shuffled `projectBoard` snapshot, status-prefix boundaries, conservative multi-phase
selection, epic self-counting, the nine real epic slugs, progress-bar boundaries, the six declared
anomaly kinds, read-only `gh` argv, credential isolation, shell-injection resistance, and graph
decoupling from `forge`.

The full command record is in [`adversarial-review.md`](adversarial-review.md). The matching review
comment URL is recorded in [`worklog.md`](worklog.md).
