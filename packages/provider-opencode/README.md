# @rickylabs/provider-opencode

A `SubagentProvider` over a long-lived `opencode serve`, for the `opencode` and `opencode-run`
harnesses on the `ctx.subagents` seam.

Owned by **E3 · [#33](https://github.com/rickylabs/harness/issues/33)**, implemented by
**[#55](https://github.com/rickylabs/harness/issues/55)**. It is E3's second provider, and the first
one that talks to something it does not own. [`provider-claude`](../provider-claude/README.md) holds
a child process: it is the run's parent, and when it goes away the run goes with it. This one holds a
socket to a server that was already running and will still be running afterwards, and every
difference below follows from that one fact.

## The two-call launch, and what it buys

`POST /session` mints the session id. `POST /session/:id/prompt_async` starts the agent. The handle
therefore exists **before** the work does, and two things the contract has always been able to say
become things a provider can actually mean:

**`queued` finally means something.** The contract splits alive into `queued` and `running` because
"queued for forty minutes" is a governance problem and "executing for forty minutes" is not.
`provider-claude` can barely use the distinction — it holds the process, so the first thing it sees
is the run working. Here they are genuinely different states: `prompt_async` returns `204` the moment
the server has *accepted* the prompt, and the first event on the bus says it has begun acting on it.
A run sitting in `queued` is a run the server took and has not started.

**`unknown` is a state a run can come back from.** When a prompt's reply is lost, whether the agent
started is genuinely unknown — but the session id is already ours, the run is in the map, and the bus
is already watching it, so the next event settles the question by itself. `provider-claude`'s
`unknown` is blind; it has nothing to name. This one hands back a live reference:

> the prompt's reply was lost (…), so this run may or may not have started; it is watchable as
> session `ses_x` — observe it, and stop it if it is alive

That is the difference between *something may be happening somewhere* and *go and look here*.

The same split decides the verdicts. A failed `POST /session` is **refused**: no prompt was sent, a
session is inert until it is prompted, and the worst case is litter rather than a second agent on the
branch. A failed *prompt* is **unknown**, which `isSafeToRetry` deliberately does not license. A
prompt the server read and rejected is **refused** *and* releases the run id and deletes the session,
so the retry the contract licenses is not then blocked here as a duplicate.

## `unknown` is not `refused`, and a status code is not proof

`isSafeToRetry` licenses a retry on exactly one word — `refused` — so `refused` is a claim that
*nothing is executing*, not a summary of how the request went. Four places in this package have to
decide it, and `refutes()` is that decision written once:

| Outcome | Refutes? | Because |
| --- | --- | --- |
| `4xx` | yes | the server read the request, evaluated it, and declined |
| `5xx` | **no** | `502`/`503`/`504` describe an intermediary's patience, not the origin's work |
| malformed | no | it answered; we could not read what it said |
| unreachable | no | the request may have been received, run, and its reply lost |

The `5xx` row is the one that costs money to get wrong. A `504` on `prompt_async` is the exact shape
of *the agent started and the gateway stopped waiting*; reading it as `refused` licenses a retry, and
the retry puts a second agent on a branch the first one is still holding.

Two more rules keep the same word honest under concurrency:

- **The run id is reserved before the first `await`.** `dispatch` suspends twice before it has a
  session id to store, and a store that only gains its entry at the end of that is one two callers
  can both pass the duplicate check on. The reservation is what the second caller collides with; an
  early refusal releases it, so a refused dispatch does not burn the id.
- **The bus outranks a reply that is older than it.** A `204` still in flight can land on a record the
  bus has already carried to `finished`; writing `queued` over that reports an ended run as one that
  has not begun. So the post-`await` writes are guarded, and a *lost* reply for a session the bus has
  since seen working is `accepted` — a launch that has been observed is a launch, however badly the
  request that caused it ended.

## Using it

`fetch` is **injected**, not imported. A composition root binds the real transport; the suite binds a
fake.

```ts
import { createProvider, createTransport } from "@rickylabs/provider-opencode";

const { http, stream } = createTransport({ baseUrl: "http://127.0.0.1:4096", fetch });
const provider = createProvider({ http, stream, logDir: "/var/log/opencode" });

const dispatched = await provider.dispatch(
  {
    harness: "opencode",
    model: "z-ai/glm-5.2",
    effort: "medium",
    router: "openrouter",
    prompt: brief,
  },
  "run-1",
);
```

`baseUrlProblems()` is worth calling on the configured url first. `new URL("n5:4096")` parses — with
scheme `n5:` and the rest as an opaque path — so a host:port written without `http://` is a *valid*
URL object that no request will ever reach. Checking it at configuration time is cheaper than an
`unreachable` on every dispatch.

## The router, which is this provider's alone

`subagents` pins the set (`n5air`, `n5air-rocm`, `openai`, `openrouter`), and
[`routing`](../routing/README.md) requires every opencode route in the matrix to name one. For the
other providers, where a run executes follows from which provider was chosen. For this one it does
not: the same harness reaches a local GPU on the N5 or a per-token relay depending on a field in the
request.

The translation is an assignment — `router` is `providerID`, `model` is `modelID`, verbatim, no table
in between — because `routing` pins opencode models **unprefixed** and a table here would be a second
spelling of every pin in a second place.

The one check that is not an assignment: `LOCAL_MODEL_IDS` are pinned *with* their `n5air/` prefix,
and `n5air` is also a router, so `router: n5air` with either of them would name the provider twice.
Stripping the prefix and sending it doubled are both guesses, and a guess that lands wrong runs the
job against a model nobody asked for — the house's most expensive bug shape, and the one
[#59](https://github.com/rickylabs/harness/issues/59) exists because of. So it refuses, and names
both spellings. That costs the two local evaluator seats on this provider until
[#49](https://github.com/rickylabs/harness/issues/49) can read `GET /provider` from a real server.

`router` is required here for `opencode-run` as well, which is stricter than `validateDispatch`. The
prompt body's `providerID` has no default, and the alternatives are to pick one here — a second place
deciding routing — or to send a request the server rejects with a status a coordinator reads as a
flake.

## A dispatch that cannot be watched is refused

Everything this provider knows about a live run arrives on `GET /event`. So the stream is opened
**before** the session is created, and a dispatch that cannot get one is refused with nothing sent.

This repository exists because its owner kept having to ask an orchestrator "status ?". Refusing to
start is a cost; starting something nobody can see is the failure. Concurrent dispatches share one
in-flight connection attempt — two server-wide streams would fold every event into the same records
twice.

The mirror image is `observe`. While the stream is down a record is a photograph: it was true, and
nothing says it still is. So `observe` reconnects on demand and, if it still cannot, downgrades a
*live* run to `unknown` with the time the photograph was taken. Terminal states are exempt, and that
is not an inconsistency — `finished` and `failed` are facts about something that already happened and
they do not expire.

**A reconnect returns a connection, not the news.** `GET /event` is live-only: it replays nothing, so
every event that arrived while there was no socket is simply gone, and the run may have finished
inside the gap. Treating a fresh socket as evidence about a record written before it is the stale
snapshot failure wearing a green light. So each connection carries a generation number, and a live
run last spoken for on an earlier one is `unknown` until the current connection says otherwise — at
which point `observe` speaks plainly again. A counter rather than a timestamp because a reconnect is
a *discontinuity*, not a point in time, and because a check against clock values is unfailable under
the frozen clock the suite injects.

## Never printing `auth.json`

#55's third acceptance criterion is satisfiable by not typing the string, and unkeepable that way:
the path is something the *server* says, in an error body, a rejection carrying a config path, a
stack in a JSON reply. So it is a predicate rather than a promise.

- `scrub()` is applied at exactly one boundary — every detail this provider emits goes through it,
  including the ones built entirely from our own words, because at the call site they are
  indistinguishable from the ones that are not. A redaction applied at forty call sites is a
  redaction missing at one of them.
- `leaks()` is the same rules as a query, and `leaks(scrub(x)) === []` is a property the suite
  asserts over every credential shape it knows. That test has already caught one regression:
  `<redacted>` satisfied the named-field rule's own value pattern until angle brackets were excluded.
- `logDir` is **not** defaulted to the opencode data directory — that is where `auth.json` lives, and
  pointing evidence collection at it would be a leak with a delay on it. A `logDir` that names a
  credential file refuses every dispatch outright, because artifact paths are published.
- Nothing here reads a credential from disk or from the environment. Whatever a deployment needs on
  the wire is handed in as `headers` by the composition root.

## Shutting down does not stop anything

`shutdown()` closes the event stream and clears timers. Nothing else.

Not an oversight and not a weaker `provider-claude.shutdown()`. Runs on a long-lived server are meant
to outlive the coordinator process, and a provider that aborted them on the way out would turn every
restart into an outage. `provider-claude` reaps on shutdown because its runs are its children. These
are not.

What `stop` does own is the distinction between *we ended it* and *it was already over*: an abort the
server answers `true` records `stopped: <reason>`, one it answers `false` records that there was
nothing to abort. Telemetry that says otherwise is a sentence claiming we did something we did not.
And a stop in flight changes how the next event reads — a session disappearing under a live run is a
failure when nobody asked and a success when somebody did.

## Why the SDK is not a dependency

The same argument [`provider-claude`](../provider-claude/README.md) makes about the Agent SDK, one
size down. `@opencode-ai/sdk` is a generated HTTP client over six endpoints; taking it on would add a
package and a version to a CI job billed by the minute in exchange for types we can write here in
forty lines and a wire format we would still have to verify.

The honesty that costs is stated once, in `http.ts`: **nothing here has been run against a real
`opencode serve`.** The endpoints and request bodies come from the vendor's HTTP documentation; the
response *shapes* are never read by property access. Every one goes through a checked reader that
returns `null` when the reply is not what was assumed — which the verbs turn into `unknown`, a state
the contract has a meaning for, rather than a `TypeError` in a background loop that leaves a run
reported as running forever.

Framing is a pure fold for the same reason. An SSE frame can span two chunks and a chunk can hold
three frames, so `feed()` is tested against the split points a real socket produces — a frame in
three pieces, three frames in one, a chunk ending exactly on a boundary, a multi-byte character cut
in half — instead of the tidy one-frame-per-chunk a fake would otherwise hand it.

## Still open

Deferred deliberately, each with an owner:

- Every reply shape is a structural guess until there is a real server to check it against —
  [#49](https://github.com/rickylabs/harness/issues/49). The readers are written so that a correction
  is a one-line diff.
- `translateModel` refuses a `router`-prefixed model id, which costs the two `n5air/` local evaluator
  seats until `GET /provider` can be read live. Same issue.
- `GET /global/health` and `readHealth()` exist and nothing calls them; a preflight belongs with the
  composition root that binds the transport.
- Nothing binds the real `fetch` yet — the `dsh-app` row is not written.
- A deadline past `TIMER_CEILING_MS` is clamped rather than honoured, and says so through
  `untranslated()`.
- `steer` reuses the run's own model rather than re-reading configuration, so an interjection cannot
  switch models mid-run. Whether the server honours a second prompt into a busy session is unverified.

---

Workspace conventions: [`packages/README.md`](../README.md). Why there are two seams rather than one:
[`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).
