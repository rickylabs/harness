# Context pack

I1 plan evaluation is admissible and its nine narrow fixes are incorporated. Implementation
is in PR 342 at source 495b815; local gates and CI passed, independent source review is on issue
343. The reviewer has independently corroborated native command/model selection; applied effort
remains unknown. See `plan-eval.md` and the implementation run linked from PR 342.

I4 has a concrete independent draft in `i4-plan.md`; no I4 source has changed. Before-spawn
integration remains the upstream handoff in `dispatcher-handoff.md`, not a deployed change.
Profiles are present and remain markdown. Dual-agent promotion is still owner fork 1.

Review request 340 was withdrawn; its running evaluator subsequently acknowledged stand-down
on the issue and performed no evaluation. That is a session acknowledgement, not proof of OS
teardown. The native plan review on 341 produced the accepted content and admissibility update.
The source-review row selects native Opus fallback; it is not the plan-review Fable row.

NetScript MCP live-service discovery returned no services because its Aspire discovery reported
project_root_mismatch and other sources were absent. `list_service_operations` for cockpit-api
therefore returned service_unknown. That is a discovery limitation, not evidence the API has
no handlers. No event schema or endpoint was invented; proposed consultation events remain draft.
