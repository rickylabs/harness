# issue-agent-ancestry--alpha — plan

Summary: ship the narrow [#379](https://github.com/rickylabs/harness/issues/379) public reason slice first; leave live ancestry and budget claims unproven until their own evidence exists.

## Decisions

1. Keep `routeObservedReasons` additive in schema 1. A required schema change would make older agent rows unreadable before a synchronized release. The decoder strictly validates the field when present (`packages/contracts/src/agent-observations.ts`).
2. Allow only the current Orchid `observer-unavailable` reason sentence. The alternative, publishing arbitrary private receipt text, could reveal paths or credentials (`cmd/divybot/matrix.go:384-388`).
3. Preserve `route.requested` and `route.observed`; receipt reasons do not certify values (`packages/contracts/src/agent-observations.ts:168-189`).

## Owner decision received

Coordinator decided 2026-09-27; Eric can overrule: the resolved route gets a default token budget per tier/profile from routing config; an issue `max-tokens` override wins; null is sent only if neither exists. This supersedes the earlier fork. The current Orchid route has no budget (`cmd/divybot/matrix.go:75-86`), so adding and proving that source is a separate implementation gate for [#381](https://github.com/rickylabs/harness/issues/381).

## Dependencies and gates

1. Validate receipt reason and public decoder → publish a reviewed contracts version → cockpit consumes the exact shape.
2. Deploy Orchid goal writer and native identity → authorized child-spawning dispatch → full issue tree proof.
3. Tests: baseline red before implementation; receipt and decoder mutation controls red when guards weaken; targeted and package suites green after restoration.

## Spikes and risks

- S1, live runtime ancestry: identify the running Orchid binary and obtain one authorized dispatch with a native child; check issue, dispatch, root and depth from the live feed. The current seat has no container access, so this gate is unproven.
- S2, route budget source: define and verify the routing-config tier/profile default that the coordinator chose, then test override, fallback and null in Orchid before claiming [#381](https://github.com/rickylabs/harness/issues/381) acceptance.

| Risk | Likelihood / impact | Executable gate |
|---|---|---|
| Receipt writer changes its fixed vocabulary | Medium / medium: reason becomes unavailable | Producer/reader fixture using the actual Orchid `receiptFor` shape; invalid source must fail closed |
| A valid requested effort differs from effective dispatch effort | High / medium: reason disappears | Fixture with unequal efforts must decode a valid receipt |
| Runtime ancestry or goal differs from synthetic tests | High / high: alpha bar fails | S1 authorized live dispatch and native goal read-back, not a fixture |
| Route default is absent or misapplied | High / high: budget column lies | S2 configured tier/profile and issue-override tests plus live read-back |
