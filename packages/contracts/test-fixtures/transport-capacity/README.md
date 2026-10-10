# Orchid capacity snapshot

`orchid-104.json` is the occupied-seat publication recorded by running
`TestAdmissionBudgetPublishesCapacityBesideAvailability` from Orchid merge
`5e91ce5` (PR [#104](https://github.com/rickylabs/orchid/pull/104)). A log statement
in a throwaway source archive captured the actual serialized `raw` bytes. Only
`observedAt` and `validUntil` were normalized to the existing governance fixture
interval; the rows and explicit nulls are unchanged. This is synthetic test
accounting, not an owner reading. Claude has no computed budget, Codex occupies
its one seat, AGY has a computed zero cap, and OpenCode has no configured pools.
