# One live issue ancestry proof

Owner-authorized scope: create exactly one Harness issue, apply its dispatch label once,
run exactly one native child on the lowest supported matrix workload tier, and read the
real assignment through the existing consumer. Do not alter other labels, production
configuration, receipts, native telemetry or process lifecycle. This authorization is
specific to this proof and supersedes the earlier no-dispatch instruction for this issue only.

The chosen issue is [375](https://github.com/rickylabs/harness/issues/375), profile `leaf`,
tier `simple`, role `implementation`. The official NetScript matrix CLI and Orchid's
unchanged resolver selected `openai`, `gpt-5.6-luna`, `max`, native `codex`. No model pin,
owner override, alternate dispatcher or synthetic assignment was used. `simple` is the
lowest workload tier; `trivial` is not an accepted tier and its inspect-only query exited 2.
The proof brief requests one native child, a soft 8,000-token prompt budget and an
eight-minute dispatch timeout. The token prompt budget is not asserted as runtime enforcement.

Source revisions:

- Harness main `7c4e4db70a6dd00075353158e2d5e83e48564f92`, containing merged PR 374.
- NetScript matrix `f3324909e0896cedc9729005bac5f508e122d6c6`.

The complete issue body was read back and compared before the only trigger-label write.
The matrix was queried again immediately before that write. The root brief requires a
fresh matrix query before the one native child, no further delegation, and no evaluation
or product changes. The native runtime alone must write parent metadata.

PASS requires a decoded real per-issue tree with a root and native child. A dispatch state,
ready terminal, inferred time match, or the agent's own completion report cannot supply
missing identity. If the native binding is absent, preserve `ancestry_unavailable` and
report INCONCLUSIVE. Every cost row retains its own kind, unit, source and availability;
unknown runtime measurements stay unknown.

Evidence publication is limited to the canonical public observation, counts, closed
reasons and explicit public terminal references. No raw receipt, native identity, operator
location, credential, host, address or live spend may enter this record. Tests and builds
use a fresh owned clone; the shared checkout and its dist are not evidence.
