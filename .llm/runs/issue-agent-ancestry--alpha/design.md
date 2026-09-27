# issue-agent-ancestry--alpha — draft design

Summary: expose five bounded Orchid receipt reasons on the existing agent observation, with explicit unavailable values if the private source fails.

- Read `receipt.json` only inside the existing private reservation, as a regular 0600 file through `O_NOFOLLOW`, capped at 16 KiB. Require schema 1, the same transport and physical model as `dispatch.json`, exactly the five expected fields, and the writer's fixed reason code/text. Orchid records requested effort separately from effective dispatch effort, so they are not compared.
- Add optional `routeObservedReasons` to schema 1 agent roots. Legacy producers and children can omit it. It carries no observed value; `route.observed` remains independent. A failed receipt validation yields `unavailable / receipt-unavailable / null` in each field.
- Validate and normalize the additive field in `readAgentObservations`. Include it in the public root revision so a changed reason changes the row revision.
- Verify the guard by weakening it in isolation and showing the privacy test fail, then restore it.
