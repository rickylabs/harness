# Live governance — #205 research (remaining live half)

**Round 2, amended in flight 2026-09-07** after the owner named the data source and two live receipts
were produced. Round-1 review disposed in `disposition.md`; structural changes in `drift.md`. Baseline `eef24f9ea02563d318a2f6b1d6c2f26e268d9b61`, worktree
`the isolated run worktree`. Read-only investigation.

## Summary

The consumer half of #205 is shipped and independently PASSed (#216, #226): the envelope, the
whole-value parser, the renderer, the allowlisted projection and the strict downstream schema all
exist and are under test. **What is missing is transport.** Nothing fetches a
`GovernanceObservation`; `--observations` is a hand-typed path
(`packages/telemetry/src/cli.ts:193-195`, `:265-278`).

Round 1 assumed no governor existed and planned to synthesise governance facts from telemetry's own
recovered transcripts. **That assumption was wrong.** An authoritative per-account burn-rate governor
exists, in production, in the public divybot coordinator, and #63 states it "stays authoritative until
the port is at parity". So the correct remaining work is not to invent readings — it is to **read the
authoritative ones through a configured, read-only source adapter that feeds the existing parser
unmodified**.

That single adapter is what carries #205 toward full acceptance, because every acceptance fact —
per-account quota, provider ledger, host capacity, structured admission reasons with timestamps — is
already a field of the envelope the display already renders. What each fact then depends on is a
property of the **source**, and that is enumerated exactly below.

## Primary source: the existing governor

[observed — `rickylabs/orchid`, public, single-file divybot coordinator, commit
`d344bd037bcf10150fd12daef8ffa277576cd94a`; public source inspected read-only; topic:
production subscription governor; retrieved 2026-09-07]

Line references below are to that copy's `main.go` unless stated.

### It reads real per-account meters, not transcripts-as-history

`sampleQuota` (`main.go:1444-1475`) reads, per account, the freshest reading across hosts: claude from
the statusline tee, codex from the newest rollout `token_count`. Its own comment states the property
that matters here — rate limits are account-global because the fleet shares one oauth per agent, so
the freshest host wins. `parseHostQuota` (`main.go:1366-1445`) decodes both vendor shapes into a
common `RateLimit{UsedPct, ResetsAt}` for the 5h and weekly windows, keyed off `window_minutes <= 600`
for codex. Real captured payloads are pinned in `governor_test.go:8-11`.

**Accounts are named in configuration, not derived.** `accountKey` (`main.go:1303-1315`) maps agent
names onto pacing accounts (`opencode`/`codex-run` → `codex`), and `Config.accounts`
(`main.go:1317-1334`) enumerates the distinct accounts across targets. This is the answer to the
account-identity problem round 1 raised as a fork: **it is configuration**, and the production system
has always treated it that way.

### It produces real admission decisions with a binding window

`Gov` (`main.go:139-151`) is the policy: `weekly_ceiling_pct`, `slack_pct`, `max_active`,
`min_active`, and three durations. `decide` (`main.go:1597-1668`) returns a `govDecision`
(`main.go:1478-1487`) carrying `cap`, `binding` (`"weekly" | "5h" | ""`), `overPace`, both burn rates,
both targets and a projected end-of-week used%. It **pauses** with `cap: 0` at or above the ceiling,
**throttles** to `min_active` inside the slack band, and **fails open** to `max_active` when the
governor is off, the meter is unread, or the data is thin. `curCaps` (`main.go:1895-1917`) turns that
into the per-account admission budget, and the tick subtracts running jobs from it
(`main.go:2038-2050`).

That is the exact vocabulary #205 asks to display: an allow/throttle/pause state, per account, with
the window that is binding and the numbers behind it. It is decided by a governor with authority; it
is not inferable from anything in this repository.

### It persists a time series, and none of it is ours to scan

`State.QuotaSamples` and `State.PrevCap` (`main.go:263-277`) persist the per-account burn-rate ring
and the slew anchor to a `state_file` (`divybot.example.json:8`). `QuotaSample`
(`main.go:1275-1284`) carries `account`, `ts`, and both windows' used% and reset instants.

This run did **not** read any live state file, credential, or host, and the plan does not either. The
sample is cited as a shape, from public source, to prove the facts exist and to specify the handoff.

### What the governor does *not* have

Read carefully, because it bounds what full closure can mean:

- **No metered spend ledger.** There is no dollar accounting anywhere in the governor.
- **No host RAM/VRAM bytes.** `Host.capacity` (`divybot.example.json:19,27,35`) is an integer slot
  count for concurrency, not bytes of memory. `CapacityReading` wants
  `vramUsedBytes`/`ramTotalBytes` (`packages/contracts/src/governance.ts:102-109`); nothing here
  produces them.
- **No HTTP status surface.** `net/http` appears twice in 3,351 lines, both for an ntfy push
  (`main.go:3291,3295`), and the README states the dashboard is gone and "`herdr --remote <host>` is
  the UI". **No public HTTP status endpoint is identified in this source.** That is a statement about
  the source read, not a claim about any deployment.

## What is already shipped, so it is not rebuilt

- envelope, whole-value validation, epoch-ms freshness, future/reversed/stale/never-read all
  distinguished — `packages/telemetry/src/observations.ts:39-45`, `:167-172`, `:333-335`, `:342-343`,
  `:390`, `:404-415`
- one shared renderer ahead of progress; `unknown` rather than `0 B` or `100% free` —
  `packages/telemetry/src/render.ts:104-170`
- hand-allowlisted public projection in `status` and `tree` — `packages/telemetry/src/public.ts:122-130`,
  `:224`, `:292`, `:373`
- explicit-unavailable default when no input is supplied — `packages/telemetry/src/snapshot.ts:238`
- `--observations <path>`, read per invocation, path never entering a public note —
  `packages/telemetry/src/cli.ts:193-195`, `:265-278`
- strict downstream consumer — `packages/dsh-app/src/plugins/board-projection.ts:103-119`, `:523-537`

The #216 evaluator was explicit that this is evidence for the display half only
[observed — GitHub issue #205 comment, independent exact-head evaluation at `898163a`; topic: closure
limits; retrieved 2026-09-07].

## Recovered historical evidence in this repository — and why it is not the answer

Round 1 proposed building on these. It was wrong to, and the wording is corrected here.

| Evidence | What it actually is | Why it cannot carry acceptance |
| --- | --- | --- |
| codex `rate_limits` in a rollout (`packages/telemetry/src/backfill/codex.ts:73-89`) | a **recovered historical reading** — a vendor statement recorded when the run wrote it | telemetry's own model: a quota reading "is only ever as fresh as the run that observed it" (`packages/telemetry/src/model.ts:62-66`). It also carries no account identity. |
| opencode `cost` column (`packages/telemetry/src/backfill/opencode.ts:8,58,125`) | **recorded per-run spend** from the relay's own billing rows | not the authoritative provider ledger #64 requires |
| `total_cost_usd` (`packages/provider-claude/src/sdk.ts:160`) | **SDK cost accounting** | not confirmed billed dollars |
| `verdict: "refused"` + clipped note (`packages/dsh-app/src/instrument.ts:234-241`) | a **provider** refusal | carries no regime and no governor behind it; telemetry already refuses to promote one to a row (`packages/telemetry/src/live.ts:444-450`) |

Account identity cannot be recovered from any of them. The reviewer suggested keying a registry on
`source`+`limitId`; that is **also insufficient** — two accounts on the same vendor plan share a
`limitId`, and codex `session_meta` carries no account field (`packages/telemetry/src/backfill/codex.ts:135-139`).
The production system does not derive account identity at all; it names accounts in configuration.

## The sidecar, precisely

ADR 0002 is accepted and ratified, and its authority table gives `status <project>` as "lists the
container and the volume. Reads nothing else, writes nothing"
(`doctrine/decisions/0002-sandboxctl-execution-channel.md`, "The authority surface"). It also fixes
two rules that survive into this plan: a sidecar that is down must read **`unknown`, never `failed`**,
and **"there is no fallback"** to ssh.

Two corrections to round 1:

- **No sidecar is identified in this repository; its deployment status is unverified** and the
  owner's endpoint/config answer is pending. A repository scan cannot prove absence anywhere.
- **`sandboxctl status` is not a governance envelope and must not be described as one.** It carries no
  account, no bytes, no spend and no admission. A `status`-only reader was withdrawn for that reason
  (`drift.md` D-2), not because the channel is unauthorised.

A container's own memory reading is likewise not a substitute: whatever a container reports is not
the target host's number, which is the only number `CapacityReading` is about. (Round 1 also asserted
a cgroup-scoping property; that assertion was unverified and is withdrawn — the refusal does not need
it.)

## Where each #205 acceptance fact stands, and on what it depends

| Acceptance fact | Carried by the envelope? | Authoritative source exists? | Remaining dependency |
| --- | --- | --- | --- |
| quota **per account**, with timestamps and provenance | yes — `SubscriptionAccount[]` with per-window `binding`, `usedPercent`, `resetsAt`, per-leaf `observedAt` | **yes** — governor `sampleQuota`/`parseHostQuota`, accounts named in config | the source must emit the envelope; endpoint/config location is the pending owner answer |
| provider **spend** | yes — `MeteredSpend[]` | **no** — governor has no dollar accounting | #64 (metered-spend regime). Until then the source emits the regime unread, per contract. |
| local **capacity headroom** | yes — `CapacityReading[]` in bytes | **no** — governor has slot counts, not bytes; `sandboxctl status` has neither | #65 (local-capacity regime), plus **F1** if the reading is to cross the sandbox channel |
| actual **admission** pause/throttle reason | yes — `AdmissionObservation` with regime, state, refusal reason/detail, own timestamps | **yes** — `govDecision.cap`/`binding`/`overPace` | the source must emit them item-scoped; #66 wires the gate in-repo when the port reaches parity |
| refresh **without an agent** | n/a | n/a | provable offline today: `status`/`tree` rebuild from the source every invocation |
| **no sliding values committed** | n/a | n/a | held by construction: the adapter reads, never writes |

Reading that table honestly: **a configured authoritative source closes two of the four value
criteria outright and makes the other two honest unread rows with named owners.** No amount of work
inside this repository closes spend or capacity, because neither has a producer anywhere — in this
repository or in the authoritative one.

## The exact remaining external facts

1. **Where the authoritative source is reachable** — a file path or an endpoint, plus its auth scheme
   and credential location. Asked of the owner; **no answer yet**. Not a design fork; a fact.
2. **Whether that source emits a `GovernanceObservation`, or must be taught to.** Nothing in the
   public divybot source emits one today. If it must be taught, the change is small and fully
   specified by the mapping in `plan.md` §"Source handoff" — `QuotaSample` and `govDecision` already
   hold every field the envelope needs for quota and admissions — but it is a **sibling-repository
   change and out of this run's mutation surface**.
3. **Whether a host byte reading is authorised at all** — fork **F1**.
4. **Whether to activate** once the above are known — fork **F5**.

Nothing above is reported as green, and nothing is guessed in `plan.md`.

## Ownership consequences

- The adapter belongs in `packages/telemetry`: it feeds telemetry's own envelope, through telemetry's
  own parser, into telemetry's own renderer, and telemetry's stated model already puts I/O at the
  edge and purity inside (`packages/telemetry/src/model.ts:1-12`).
- It requires **no new workspace dependency** — `node:fs/promises` and the global `fetch` on Node ≥ 24
  (root `package.json:9-11`) — so `packages/telemetry/package.json`, its `tsconfig.json` references
  and `pnpm-lock.yaml` are untouched and `scripts/check-project-graph.mjs` sees no change. (Round 1's
  withdrawn `governance` import *would* have required all three; see `drift.md` D-2.)
- `packages/governance` is **not** touched. The verdict remains E5's, and the authoritative governor
  is external until #63 reaches parity.

---


# Amendment — the owner named the data source, and three facts were proven live

[owner — harness coordination; topic: governance data source is the netscript agentic toolchain,
usable against runs on other authorized projects; 2026-09-07]. Source authority: upstream HEAD
`8ba53bc50ca02aab29e99ba5362728839b8f1713`, read-only checkout
`refs/netscript`. Paths below are into its
`.llm/tools/agentic/`. **That checkout is sparse — only `.llm` directories are populated — so every
statement about what it does or does not contain is scoped to the path actually scanned.**

## Receipts produced this run

Executions, not readings. Each emitted booleans only; no value, label, credential, body or identifier
was printed, copied or retained.

| Receipt | What was run | Result |
| --- | --- | --- |
| **Live subscription usage** | `fetchOpenCodeGoUsageSnapshot` with a process-injected `OPENCODE_API_KEY`, under `--allow-env=OPENCODE_API_KEY --allow-net=opencode.ai` and **no `--allow-read`**, with `readTextFile` and `stat` explicitly rejected (private operational probe; sanitized result recorded here) | exit 0; all three percentage windows finite; capture timestamp valid |
| **Live metered spend** | owner-authorized read-only `GET https://openrouter.ai/api/v1/key` with a process-injected `OPENROUTER_API_KEY` and no file access | finite non-negative total credit usage and current-month usage |
| **Local memory scope** | root inspected the **current cgroup's** RAM | present at cgroup scope; GPU **unknown** |

The first receipt settles a question earlier drafts got wrong. `resolveCredential` returns the
environment value first and only falls back to a credential file when it is absent
(`lib/provider-credential.ts:78-79`), so an injected credential with denied file readers never opens a
file. **Live usage access is proven without any prohibited auth-file read**, and the earlier
"requires the CLI's own credential-file access" inference is withdrawn.

The second settles another: OpenRouter publishes total credit usage in USD and current-UTC-month usage
on the current-key endpoint
[observed — https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key; topic: current-key
usage fields; retrieved 2026-09-07] and
[observed — https://github.com/OpenRouterTeam/terraform-provider-openrouter/blob/main/docs/data-sources/api_key.md;
topic: total and monthly usage USD; retrieved 2026-09-07]. **A live metered-spend source exists and is
reachable**, so the earlier "no billed-spend producer, not buildable" claim is withdrawn.

No live dispatch, admission, reservation or management action was exercised by either receipt.

## What netscript ships, read at the source

### An authenticated live usage reader with an injectable boundary

`fetchOpenCodeGoUsageSnapshot` (`runtime/provider-usage.ts:138-176`) GETs `OPENCODE_GO_USAGE_URL`
(`config/endpoints.ts:26`) and returns an `ExpenseUsageSnapshot` whose `percentageWindows` carry
`percent`, `status` and provider `resetsAt` for `rolling_five_hours`, `weekly` and `monthly`
(`:88-115`, `:117-137`). Its dependencies — `env`, `fetch`, `now`, `readTextFile`, `stat` — are all
injectable (`:77-83`), which is what made the receipt above possible.

**`capturedAt` is stamped by the injected `now`, not by the provider.** It is taken once at the call
site (`:174`) and travels with the snapshot. The payload carries provider `resetsAt` per window but
**no provider-stated capture instant**, so `capturedAt` is honestly a reader-stamped observation time
and must be presented as one. Whether the stamp is taken before or after the fetch is a detail the
adapter fixes deliberately rather than inherits (plan D18).

### The CLI edge is not sufficient on its own

`runExpenseWatch` prints an **`ExpenseDecision`** (`runtime/cli/expense-watch.ts:101-103`), and
`ExpenseDecision` has **no `capturedAt`** (`runtime/subscription-expense.ts:70-78`). It carries
`snapshotAgeMs`, which is a duration, not the original timestamp — and the CLI computes it against a
`now` it also passes into the fetch (`runtime/cli/expense-watch.ts:87-89`), so supplying `--now`
drives it to zero. **An earlier draft claimed the CLI emits an `ExpenseUsageSnapshot` with
`capturedAt`; that was wrong and is withdrawn.** A reader that needs a real observation instant calls
the library behind an injected adapter, as the receipt did, and never reconstructs a timestamp from an
age.

### A closed allowance vocabulary that fails closed

`evaluateSubscriptionExpense` (`runtime/subscription-expense.ts:142-253`) is pure, has a closed
`ExpenseDecisionReason` enum (`:59-69`), and refuses beyond `EXPENSE_SNAPSHOT_MAX_AGE_MS` = 15 minutes
(`config/subscriptions.ts:5`) — a source-declared validity bound the adapter cites rather than invents.
Percentage-derived `usedUsd` is `limitUsd * percent / 100` (`:117-127`): **allowance accounting, never
billed spend.**

### Routing state is a routing transition, not an admission refusal

`RoutingState` (`runtime/routing-state-machine.ts:50-67`) carries `phase`, a closed `reasonCategory`
(`quota | plan_limit | session_limit | rate_limit | provider_outage`,
`runtime/routing-signal-classifier.ts:6-13`), `detectedAt`, optional `resetAt`, `affectedSession`,
`fallbackDepth` and `restorationStatus`.

**It is not item-scoped, and it is not evidence that anything was refused.** A session quota transition
can be detected *after* the effect it describes has already begun; `affectedSession` is a session, not
a work item; and a fallback that changed a route is a statement about routing, not about an admission
that was denied. Mapping it into `AdmissionObservation` — which asserts a refused `DispatchOutcome`
for an item — would claim an authority the state does not carry. An earlier draft proposed exactly
that mapping; **it is withdrawn.** Where no actual refusal evidence exists, the admission set stays
empty with a note.

Its read edge is also out of bounds here: `readRoutingStates` reads
`~/.config/netscript-agentic/runtime` (`runtime/cli/routing-state.ts:35-42`). Invoking a helper that
reads a prohibited path does not make the read permitted — running an observational helper over those
files is a different act from a previously authorized provider launcher executing natively. That task
is excluded, and routing state is an **unknown** input rather than a source.

### A mutation that must never be invoked for observation

`reserveCopilotCredits` (`runtime/provider-usage.ts:32-75`) takes a lock and writes the credit ledger.
It is on no read path used here, and the injected-adapter boundary gives it no route in: the adapter
calls one named function with file access denied.

### A deprecated wrapper that can silently drop a project's runs

`codex/codex-status.ts` is `@deprecated` on its first line and caps its inventory **before** filtering
by project — `head -n ${options.sessions}` inside the `find` pipeline (`:135-141`) versus
`session.cwd === options.worktree` afterwards (`:266-267`). Any scoped inventory must use the pure
parsers (`codex/agy-live.ts:60-108`, `codex/codex-rollout-live.ts`) over its own explicit scope.

### What was not found within the scanned path

A case-insensitive search of the populated `.llm` tree for `totalmem`, `freemem`, `meminfo`, `nvidia`,
`vram` and `gpu` returned no file. **That is a statement about the scanned path of a sparse checkout,
not a proof that no byte reader exists anywhere.** Earlier drafts called this a "three-way
confirmation"; that overclaimed and is withdrawn.

## Coverage receipt — no operational counts, no identities

The standing rule keeps raw telemetry, exact operational counts and private project identities out of
artifacts and reviewer payloads. Local run metadata was inspected read-only; booleans only:

| Runtime store | Present locally |
| --- | --- |
| codex rollouts, at least one carrying a vendor rate-limit block | yes |
| claude transcript store | yes |
| opencode database | yes |
| agy conversation index and transcripts | yes |
| observability log directory | yes |

All four runtimes the owner named are represented, which is sufficient to plan an authorized
integration proof. No count, path, project name, session id or transcript content is published.
Source-of-data discovery beyond local scope remains in progress and is not a blocker.

## What each #205 fact now depends on

| Acceptance fact | Reader | Status |
| --- | --- | --- |
| quota per account, timestamps, provenance | `fetchOpenCodeGoUsageSnapshot` behind an injected env-only adapter | **reachability proven live this run**; normalization not yet built or exercised |
| provider spend | OpenRouter current-key endpoint, env-only credential | **reachability proven live this run**; normalization not yet built or exercised |
| local capacity | current **cgroup** memory at an explicitly declared scope; GPU **unknown** | collectable at container scope; a physical-host figure is a different, unestablished scope |
| structured admission pause/throttle reason | no source yet identified carrying actual item-scoped refusal evidence | producer defined in plan D20; read path testable now; the fact stays `unknown` until a real decision is recorded |
| refresh without an agent | n/a | provable |
| no sliding values committed | n/a | held: readers only, no writes |

Nothing above is reported as closed on the strength of a receipt. A receipt proves reachability; only
an exercised end-to-end run proves a criterion.

## Ownership

netscript is invoked **as a service behind an adapter, never a build-time dependency** — ratified
decision 2 (`AGENTS.md:99`). Read-only normalization at that boundary is an adapter, not a competing
schema authority: `packages/contracts` is unchanged, nothing new is published, and provenance stays
reader-owned. `packages/governance` is untouched and this repository decides no admission.
