# @rickylabs/provider-claude

A `SubagentProvider` over the Claude Agent SDK's `query()`, for the `claude` harness on the
`ctx.subagents` seam.

Owned by **E3 · [#33](https://github.com/rickylabs/harness/issues/33)**, implemented by
**[#52](https://github.com/rickylabs/harness/issues/52)**. It is the first of E3's four providers and
the one that answers the question the stub used to pose: *is a `claude-agent-sdk` run genuinely
steerable in flight, or only startable and stoppable?* It is steerable, and the rest of this package
is downstream of that.

No PTY, no `send-keys`, no directory-trust prompt to auto-Enter. The run is an async generator this
process holds. That single fact is what makes `observe` a read of memory rather than an expedition,
and `stop` a thing that actually happens rather than a signal aimed at a terminal multiplexer.

## Using it

The SDK is **injected**, not imported. A composition root binds the real `query`; the suite binds a
fake.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createProvider } from "@rickylabs/provider-claude";

const provider = createProvider({
  query,
  configDir: "/srv/agents/pool-a/.claude", // absolute, and not the operator's own
  cwd: "/srv/worktrees/feat-52",
});

const dispatched = await provider.dispatch(
  { harness: "claude", model: "opus-5", effort: "medium", prompt: brief },
  "run-1",
);
```

`dispatch` resolves once the session announces itself, so the `RunRef` it hands back already carries
the vendor's session id in `external`. Everything after that — `observe`, `steer`, `stop` — takes
that ref.

## The four verbs, and where each one's honesty lives

The contract's difficult word is `unknown`: *this run may be alive and we cannot say*.
`isSafeToRetry` licenses an automatic retry only for `refused`, because a retry on a live run is how
two agents end up on one branch. This provider produces `unknown` in exactly three places, all for
that reason:

- `query()` threw before the stream produced anything. The SDK spawns its child lazily, so most
  likely nothing launched — and "most likely" is not a claim worth attaching a retry to.
- The session did not announce itself inside `readyTimeoutMs`. Silence is not death.
- A verb was handed a `RunRef` this provider has no record of, after a restart say. The run this
  process lost track of may still be holding a worktree.

Everything decidable is decided before anything is spawned. A malformed request, a harness this
provider does not launch, a duplicate run id and an unusable config directory are all `refused` —
and the malformed-request check is `validateDispatch` itself, reused rather than paraphrased, because
a laxer check here would let a dispatch through this seam that the `/swarm` seam refuses, and they
are one request.

Steering is a second message pushed into the same `AsyncIterable` the brief travelled down, and
stopping tries `Query.interrupt()` before falling back to aborting the controller — the difference is
whether the agent gets to put down what it is holding.

## Isolation, and the half that is counter-intuitive

`CLAUDE_CONFIG_DIR` is pointed at a directory per deployment. `$HOME` is deliberately **not** changed
alongside it.

The reflex when isolating a CLI's state is to hand it a fresh home. That reflex breaks authentication
silently: the run launches, the keychain lookup finds nothing, and the failure surfaces as an agent
that cannot start rather than as a configuration mistake. `homeSurvived(base, built)` is the
invariant as a predicate anything can call, and `envProblems` refuses the three environments that
would eat something — an empty config dir (which is a fallback to `~/.claude`, not isolation), a
relative one (whose meaning depends on the daemon's cwd), and one pointed at the home directory
itself.

Because that isolated directory is not the one `dsh-telemetry` scans by default, every `Observation`
carries `<configDir>/projects` in `artifacts`. The directory, not a guessed per-session filename: the
CLI owns its project-slug scheme, and the backfill walks for `*.jsonl` at any depth anyway.

## Not leaving a child behind

Each run gets its own `AbortController`, never shared, and the abort lives in a `finally` — so a run
that ends by *any* path (a result, a throw, a stop, a shutdown, a deadline) reaps its child.
`shutdown()` covers the one exit a stream cannot see for itself: the process holding it going away.

A request's `timeout` is honoured here, since this provider owns the controller that can. Note that
`parseGoDuration` returns **nanoseconds** — it exists to reproduce Go's `time.ParseDuration` for the
executor's own `timeoutNs` field. `timeoutMs()` is the conversion, exported so the next caller has
one to reach for instead of the raw parser; handing nanoseconds to `setTimeout` overflows the 32-bit
timer, fires on the next tick, and stops every bounded run the instant it starts while reporting
`accepted`.

## What is not translated

`DispatchRequest` carries fields the SDK has no option for — `effort` above all, which is how the
matrix says *opus 5 medium* rather than *opus 5*. Dropping those silently would be the house's most
expensive bug shape: a run that succeeds while not being quite the run that was ordered. So
`untranslated()` names them, and the dispatch detail carries them on every dispatch that has any.

The model id itself is passed **verbatim**, with no table in between.
[`routing`](../routing/README.md) is the single owner of every pin, and a translation layer here
would be a second, unverified spelling in a second place. Where the CLI reports resolving a different
model than was asked for, that difference is recorded and appended to every observation — visible,
not enforced. Turning it into a refusal is [#59](https://github.com/rickylabs/harness/issues/59)'s,
once there is one real observation per model to calibrate against.

## Why the SDK is not a dependency

Measured against `@anthropic-ai/claude-agent-sdk@0.3.263`: the main package unpacks to 5,028,300
bytes, its `linux-x64` platform binary to **215,662,653**, and it declares three peers that pnpm
installs on its behalf. CI runs `pnpm install --frozen-lockfile` on every job inside a fifteen-minute
budget. Downloading ~216 MB per job for *types* from a module whose tests never call the real
thing adds installation work without exercising the SDK.

The honesty that buys is stated once, in `sdk.ts`: nothing in that file has been checked against the
vendor's own declarations. Two habits follow, and they are why the module exists at all — nothing is
read off a message by property access (every field comes out of a reader that checks the shape and
returns `null`), and the stream is typed `unknown`, so no release of theirs can fail to satisfy
`QueryFn` for a reason that is really about our guess.

## Still open

Deferred deliberately, each with an owner:

- Mapping `effort` onto a thinking budget needs one real run on the box —
  [#49](https://github.com/rickylabs/harness/issues/49).
- The `SdkUserMessage` wire shape is a structural guess, pinned field by field in `sdk.test.ts` so a
  correction is a one-line diff. Same issue.
- Verifying that no orphan CLI processes accumulate over a long run is a claim about a real process
  table. The structural half — one controller per run, aborted on every exit — is here and tested.
- Nothing binds the real `query` yet; the composition-root row in `dsh-app` is not written.
- A deadline past `TIMER_CEILING_MS` is clamped rather than honoured, and says so through
  `untranslated()`.

---

Workspace conventions: [`packages/README.md`](../README.md). Why there are two seams rather than
one: [`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).
