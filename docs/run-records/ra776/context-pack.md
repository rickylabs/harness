# Native revision context (current final)

Refs rickylabs/harness#776. Rejected scan-based READY is superseded; phase
history lives in worklog.md and review.md.

Native chain: restored workspace label plus exact agent session plus Orchid
run records select current roots; exact-key point reads own membership with
no bulk refresh. Current Herdr working state proves running; the Orchid final
phase proves assignment end without inventing outcome or end time; idle, done
and blocked are stopped turns. Bounded native-coordinate TTL checkpoint plus
native change events feed replay; the existing durable stream, TTL KV writer
and prepared Home projection publish, with no request-path lookups. Source
failure stays unknown and never revives historical roots.

Completed PRs: Harness #777, cockpit #954, Orchid #133. Reviewed heads:
Harness 6bb47ce3ea9fce086836a0a86b72d85cfb5ae4b3 (reader pin
add2eda4611bd3c38c6dcdcd3cf3ad3913afa07d), cockpit
ff07c01af2a7898fb984c10ba940f678122fe52c, Orchid
97143ced47a7b10de5e746386e9992cfad23e33d.

Final gates, all exit 0: Harness frozen install/typecheck/root build/full
test/leaks with 15 native regressions and the original 2 red controls;
cockpit check/lint/fmt/fitness/test with 2568 passed over 50 steps (2 ignored
on the existing database-less launch-request cases), parity 909 passed over 41
steps, openapi check exit 0, native resource checks 4 passed, actual
producer-consumer interop exit 0; Orchid Go gates exit 0.

No merge, deployment, or live deployment acceptance is authorized or claimed.
