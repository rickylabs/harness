# @rickylabs/llm-local

Where a `ctx.llm` request can be sent, and where it must not. LM Studio, llama-rocm, OpenRouter.

Owned by **E4 · [#34](https://github.com/rickylabs/harness/issues/34)**; the capability matrix is
**[#60](https://github.com/rickylabs/harness/issues/60)**, the adapters are
**[#57](https://github.com/rickylabs/harness/issues/57)**. Nothing here opens a socket.

## What is in here

| File | What it owns |
| --- | --- |
| `backends.ts` | The three destinations: base URL, locality, accelerator, readiness, diagnostics |
| `capability.ts` | Mechanism validation and queries over explicit model/backend placement data |
| `budget.ts` | The token-budget floor, as a branded type |
| `endpoint.ts` | A backend name plus a deployment override, resolved into a request target |
| `health.ts` | What came back of a readiness check: five outcomes, each with its own remedy |

## The line this package does not cross

[`routing`](../routing/README.md) owns every model id and the matrix that chooses between them. This
package answers *where do I send a request for `x`*, and never *should the request be for `x`*. Two
packages answering the second question is the failure mode: there would be no way to tell which
answer a run had used.

Placements come from the same wholly replaced [routing document](../routing/config/routing.v1.json).
Routing validates their shape, model references, duplicate pairs and explicit membership totality.
`checkCapability(placements)` validates the backend mechanism, verdict, refusal reason and
requirements. `requirePlacements(placements)` refuses with fixed codes before exposing anything,
and returns a detached frozen array on success. `placementOf`, `canRun`, `refusalOf`, `backendsFor`
and `placedModels` take that array first. There is no compiled placement table or model-id import.
An empty membership is legal and lists no models.

The dependency runs one way: this package depends on routing. Routing treats backend identifiers
as opaque strings and does not import this package; unsupported mechanisms refuse at composition.

## Local availability is not guessable from the id

The shipped compatibility document retains the earlier placement observations below. They are
transcribed evidence, not a fresh host probe, and cannot be inferred from a model id:

- **GLM-5.3-Flash is relay-only.** `glm5next` is absent from this box's llama.cpp build, so neither
  local backend can load it. The accelerator is not the obstacle, which is why swapping to ROCm does
  not help.
- **Ling-3.0-flash is ROCm-only, with conditions.** It segfaults on Vulkan, and it needs
  `GGML_HIP_ENABLE_UNIFIED_MEMORY=1` and `--load-mode none` to come up at all. Without those the
  server starts fine and the first request fails, which reads as a model fault.
- **LM Studio will run Ling anyway, at about 3 tok/s on CPU.** This is the dangerous placement, and
  the reason `unusably-slow` is a refusal rather than a warning: a lane routed there does not fail,
  it takes an hour and looks like a hung agent.
- **Qwen3.8-27B on LM Studio, around 40 tok/s, is the local smoke and plan-evaluation seat.** Fast
  enough that routing there is a choice rather than a fallback.

## Three verdicts, because two would force a lie

`runs` and `refused` are the interesting ones. `unverified` exists because the alternative is worse:
with only two verdicts, every pair nobody has tried has to be filed as one or the other, and both
are false. A `refused` we cannot justify blocks a route that might be fine; a `runs` we have not
observed sends a dispatch somewhere it may die.

`canRun` fails closed on `unverified`, because the question it answers is *may I dispatch here
without probing first*.

Routing enforces totality for models explicitly present in the placement section, across that
section’s declared backends. Vendor-CLI-only models need no placement. No prefix or compiled list
implies membership. `checkCapability` preserves the rule that a participating model runs somewhere.

Four refusal reasons, each with a distinct remedy, which is the test for whether one deserves to
exist: `absent-from-build` (rebuild), `crashes-on-backend` (use the other accelerator),
`unusably-slow` (do not route there), `not-served-here` (nothing changes this — it is a fact about
what the destination is).

## Readiness is probed, never inferred

`ReadinessCheck` has exactly one member, and that is deliberate. The llama-rocm container's
entrypoint is `sleep infinity`: starting the container does not start a server, so a scheduler that
reads "container is running" as "backend is ready" dispatches into a socket that is not listening and
reports the result as a model problem. There is no `"container-state"` member to select.

Each backend also carries where its failures are actually read. LM Studio is the case that proves
the field earns its place: a model that fails to load leaves nothing useful in the container's
stdout, so `nerdctl logs` shows a healthy server while every request fails. The evidence is in the
app's own log directory.

`health.ts` is that check, expressed as a reading rather than a boolean. A boolean would have to
collapse five situations that share nothing but their unhappiness:

| Reading | What actually happened | What to do about it |
| --- | --- | --- |
| `ready` | The endpoint answered and lists the model | Dispatch |
| `not-loaded` | The server is up; this model is not | Load it, and read the app's own log |
| `rejected` | A status, not a list — 401, 404, 500 | Fix the credential, the path, or the server |
| `unreadable` | Something answered and it was not the service | Check what is on that port |
| `unreachable` | Nothing accepted a connection | Start the server process |

The last two rows are the ones a liveness ping gets wrong in both directions. A reverse proxy on the
wrong port answers `200` and is not the service; a running container with `sleep infinity` for an
entrypoint is up and has no server in it. And the diagnostics travel with the reading, so a failed
load points at `/config/.lmstudio/server-logs/YYYY-MM/*.log` while a dead socket does not — that
directory is empty for a good reason when nothing ever started, and sending an operator to an empty
log file costs them the ten minutes the field exists to save.

Nothing here opens a socket. The exchange goes in as data — `{ reached: false, error }` or
`{ reached: true, status, body }` — which is the same split as
[`routing`'s `probe.ts`](../routing/README.md#availability-expires-and-everything-else-here-does-not),
for the same reason: a rule that opens a socket cannot be tested.

## A reading that cannot be projected is not projected

`toObservation` turns a reading into the shape `routing` scores, and for `not-loaded` it answers
`null` instead. `Observation.reachable` is documented as *the destination answered at all*, and in
this case it did. Setting it `false` would produce the right verdict by writing a false statement
into a record telemetry keeps; setting `completed: false` would claim the probe stopped short when it
ran to the end. Refusing to project is the honest third option: `availabilityOf` sees no observation,
answers `unknown`, and `mayDispatch` refuses — so it fails closed without lying — and the fact itself
survives on `Health.readiness`, where it is the whole point of the reading.

The same care runs the other way. `probe.ts` scores `degraded` by scanning an observation's `output`
for a vendor warning, so a body that could reach that field could steer a routing verdict. Nothing
derived from a response body is written there: `output` is authored locally from the readiness state.
A models list that happens to contain the codex marker in a description is a `ready` endpoint, not a
degraded one.

## No refusal quotes the override

`endpoint.ts` is the one place text from outside the repository becomes something a request is aimed
at, and the shapes people actually type include `https://KEY@host/v1` and `https://host/v1?api-key=`.
Both are refused — and a refusal cannot quote what it refused without doing precisely the thing it
exists to prevent, because a base URL is written into receipts, run logs and issue bodies.

Rather than exempt those two messages, no message in the file quotes the override at all. Each names
the backend, the structural fact that was wrong, and — where parsing got that far — the scheme, which
is a short closed vocabulary and never a secret. `admit.ts` reaches the same rule from the other
direction.

A query string is refused rather than dropped, which is the one that looks like over-strictness and
is not. Dropping it is the worst of the three options: the operator who wrote `?api-key=` believes
the key is being sent, the request goes out without it, and the 401 that comes back reads as a bad
credential rather than as a discarded one.

Blank falls through to the table default, because that is what an unset environment variable reads
as, and a daemon that will not boot over `LLM_BASE_URL=` in a compose file has refused the wrong
thing.

## A budget under 300 tokens is unrepresentable

Ask a model that reasons before it answers for a completion in ten tokens and it does not refuse. It
reasons for seventy-one, hits the ceiling mid-thought, and returns HTTP 200 with empty content and an
ordinary finish reason. A success-coded failure is the worst shape a bug can have, and this one is
preventable, because the budget is known before the request is sent.

`ReasoningBudget` is a branded number produced only by `reasoningBudget()`, which is the sole place
the floor is applied. A function taking a `ReasoningBudget` cannot be handed an unchecked one, and
the check cannot be forgotten at a new call site, because there is no way to spell the type without
going through the constructor.

The floor is unconditional rather than scoped to reasoning models. Scoping it would need a registry
of which models reason, and that registry is a time-sliding fact: a vendor turns reasoning on in a
point release, the table still says no, and the floor stops applying to exactly the model that needed
it. The cost of applying it everywhere is nil — a sub-300-token ceiling is not something anyone asks
for on purpose.

## Why this is a seam of its own

`ctx.llm` and `ctx.subagents` are separate because they fail differently, not because dsh happens to
name two extension points. A subscription run is metered by a quota window that refills; a relay run
is metered per token against a balance that does not. This package is the second kind, which is why
it is where a credential profile is bound — see
[`docs/concepts/02`](../../docs/concepts/02-the-two-seams.md).

The local endpoints sit here too, and they are the case that makes the split obvious: a model running
on the N5's own GPU costs nothing per token and is still not a subagent. It has no session, nothing
to steer, and nothing to observe.

In the shipped compatibility document, `moonshotai/kimi-k3` is deliberately absent from placements: it is reached through opencode's own router, on the subagent seam. Listing it
would imply this package could send it somewhere, and no adapter here ever will.

## What is deliberately not here

No chat client, and no `ctx.llm` registration. Registering the seam is the app shell's
(**E2 · [#32](https://github.com/rickylabs/harness/issues/32)**), and readiness is what a
registration needs first; a completion request built here with no seam to attach to would be an API
invented ahead of its caller.

No transport either. `endpoint.ts` says where a request goes and `health.ts` says what came back of
one, and both take the exchange as data.

Quota, spend and load are absent for a stronger reason: all three change while you read them, so a
committed copy is wrong by the time it ships. This package answers *could this ever work here*, and
`health.ts` answers *is it working right now*. What that answer is still worth ten minutes later —
how long, and when silence in a probe's output is not evidence — is
[`routing`'s `probe.ts`](../routing/README.md#availability-expires-and-everything-else-here-does-not).

---

Workspace conventions: [`packages/README.md`](../README.md).
