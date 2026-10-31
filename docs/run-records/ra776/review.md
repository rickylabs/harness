# ra776 independent supervisor review

Reviewed code head: 4a0fb466fee5e0636903405303928ea48b193103 on orch/divybot-6547382930.
Baseline red control: 905df99 (two integration tests fail there: resumed unknown vs running; oldest active dropped).
Verdict: PASS.

Scope reviewed: bounded backward native turn-boundary recovery charged to the unchanged
32 MiB frame; active/native-clock-prioritized reads; running-first output before the
existing issue/agent/byte caps; optional bounded host receipt paging (four pages of
1,000, 16,384-entry directory cap); intra-issue verified-root priority with
partialRoots retry retention under partialTrees only; strict/default backfill unchanged
and fail-closed. No contracts schema change, no cockpit change, no new root
discovery or window expansion, no liveness inferred from clocks or bindings.

Final gates (all exit 0): install, typecheck (5 stages green), build (15 stages
green), test (8 stages green, telemetry 808 pass), leak scan clean. Restart
integration tests 3/3 pass. Scoped live validation: one native running resumed
root plus native ended history, honest scan_limit.

Measured limitation: the full feed stays partial at its fixed byte cap, and frame
contention can omit the same large root in another frame. No all-live-rows
coverage is claimed.
