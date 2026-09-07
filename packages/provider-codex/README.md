# @rickylabs/provider-codex

Codex app-server protocol prerequisites for the `ctx.subagents` seam.

**Status: protocol prerequisite only.** Issue #195 ships strict `thread/start` route verification
and pre-turn orchestration through an injected raw-response port. Attachment, initialization,
ownership, observation, steering, stopping, reconnection and the full `SubagentProvider` remain
gated by [#53](https://github.com/rickylabs/harness/issues/53). No Codex provider is composed into
`ctx.subagents`.

## What ships

`startVerifiedCodexTurn` asks an already-initialized injected port to start a thread, compares the
server's applied model-provider id, model, reasoning effort and cwd with the caller's frozen request,
then sends useful input only when all four exact strings agree. Missing, malformed, blank,
uncorrelated or version-skewed observations are `unknown` and send no turn. A complete mismatch is
`refused` before useful work; failures after `turn/start` are `unknown`, so they never license an
automatic retry.

The helper mints its own JSON-RPC request ids and reads only the raw response. The injected port
does not certify correlation. It is a transport interface for tests and the future #53 adapter; this
package does not spawn or attach an app-server.

Canonical cwd and server-vocabulary provider/effort values are explicit caller bindings. This
package performs no filesystem canonicalization and no alias translation. #53 must prove those
bindings and the target daemon's protocol version before live composition.

## Evidence handling

`DispatchResult.route` carries typed four-field evidence, and `isRouteVerified` is the fail-closed
consumer check. Legacy results without evidence are unverified. Evidence source labels are closed,
and the parser selects only the four route fields instead of copying raw responses or error payloads.
The implementation reads no environment or authentication files. Callers must supply appropriate,
nonsensitive route values and handle cwd strings as described below; the helper does not perform
secret detection or redaction.

Route reasons contain the exact requested and observed strings. For cwd, those strings may be
absolute host paths. Callers must handle them as operational evidence and must not publish live
values without the appropriate review.

## What remains

The full provider will own the app-server session, the `RunRef.external` thread-id join, subsequent
turns and the optional observe/steer/stop calls. Until #53 supplies and composes that implementation,
the dsh profile's provider registry remains empty and this prerequisite cannot dispatch production
work.

---

Workspace conventions: [`packages/README.md`](../README.md). Why there are two seams rather than
one: [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).
