# Resume from ra776c

PR #777, branch `orch/divybot-6547382930`. Review at `b82bbb835` had two blocking items; both are
fixed here (see `worklog.md`). Start from `packages/telemetry/docs/native-issue-agents.md`; the
contract rule is in `packages/contracts/docs/agent-trees-and-stop-state.md` ("Uncovered issue trees
in 0.42.0").

Open after this run: Orchid #135 (covered active set; until it lands every native frame answers
`binding_unavailable`, exit 3), Orchid #136 (native admission), Herdr #5725 (native child/usage).
Cockpit #951 must read contracts 0.42 before it passes `--partial-trees` to see verified native rows.
Non-blocking review notes not done: Herdr adapter package move, splitting `collectNativeIssueAgents`.
