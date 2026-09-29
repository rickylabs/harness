# Scoped issue agent feed review — app-video-retake--490

The issue agent feed distinguishes accepted action delivery from observed termination. It attributes a raised root budget to a confirmed action receipt only after matching the bound agent and dispatch. Native activity is screened before publication; one invalid supplied activity step can still make the whole projected snapshot incomplete. These findings describe source behavior and focused synthetic tests, not a claim that any particular live process ended.

Source references below are in `origin/main` at `45151f7a06ec958738be9fda09c60e86b3430977`. The initial public comment used the earlier live-review baseline recorded in [context-pack.md](context-pack.md).

## Actions and attribution

An action receipt becomes an `action-accepted` or `action-rejected` timeline event only when its timestamp and bound agent, dispatch, repository, issue, action, outcome, and closed reason pass the projection checks. The public event retains the action and reason with source `action-receipt`, while the event ID is derived rather than exposing the receipt identifier (`packages/telemetry/src/issue-agent-feed.ts:279-296`; `packages/contracts/src/issue-agent-tree.ts:127-153`). The private reader also constrains accepted action reasons and receipt identity before a receipt reaches the projection (`packages/telemetry/src/action-receipt-cli.ts:97-137`).

A raised root budget requires a complete action scan, an accepted `raise_budget` receipt with the confirmed `goal_budget_updated` reason, the exact root agent and dispatch, matching issue and repository, a valid time, and a safe integer limit above the launch limit. Only then does the budget source become `action-receipt`; the same verified raises populate the bounded budget history (`packages/telemetry/src/issue-agent-feed.ts:209-228,254-268`). The accepted reason denotes a native goal notification, read-back, and persisted state in the receipt contract, not merely a requested new limit (`packages/telemetry/src/issue-agent-feed.ts:211-213`; `packages/telemetry/src/action-receipt-cli.ts:41-43`).

An accepted stop receipt proves delivery, not process exit. Root liveness reaches `ended` from a stop observation only after both seat and native process absence are observed; one side alone leaves it unproven (`packages/telemetry/src/issue-agent-feed.ts:128-165`). The focused root test exercises receipt-only, seat-only, process-only, and both-observed states (`packages/telemetry/src/issue-agent-feed.test.ts:550-577`).

## Independent activity inspection

The one native sub-agent independently found that the reader admits assistant-originated activity, reduces commands to allowlisted heads, screens prose and targets through the public contract, and substitutes a generic message when prose fails the screen (`packages/telemetry/src/native-activity.ts:28-45,62-123`; `packages/contracts/src/issue-agent-tree.ts:14-38`). Focused tests cover raw command arguments, private-looking paths, URLs, codes, and non-assistant content (`packages/telemetry/src/native-activity.test.ts:6-25,45-59,93-111`). My source reading agrees with that guard.

The limitation is local to the feed projection: it checks activity-step timestamps and caps the list at 20, then attaches the supplied steps without screening each one there (`packages/telemetry/src/issue-agent-feed.ts:229-232`). The final decoder rejects unsafe summaries and targets; if one supplied step fails, the projection returns an empty incomplete snapshot instead of omitting only that step (`packages/contracts/src/issue-agent-tree.ts:336-383`; `packages/telemetry/src/issue-agent-feed.ts:378-383`). This is a resilience limitation, not evidence that the normal native reader publishes unscreened text.

## Validation

- Live-review baseline: `node node_modules/typescript/lib/tsc.js -b packages/telemetry` exited 0; `node --test packages/telemetry/dist/issue-agent-feed.test.js packages/telemetry/dist/native-activity.test.js` passed 27/27 tests, exit 0.
- PR baseline: the same compile command exited 0; the same focused test command passed 29/29 tests, exit 0.

No live action was sent by this review. The test results establish the cited synthetic behavior; they do not independently certify a live stop or budget change.
