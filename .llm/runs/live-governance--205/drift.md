# Live governance — #205 plan drift (round 1 → round 2)

Why the plan changed shape rather than only absorbing seven wording fixes, and what the withdrawn
material was worth. Nothing here is deleted history: each withdrawal keeps its original rationale and
states the honest limit that made it insufficient.

**Cause of drift.** A new independent primary source was supplied after round 1:
[observed — `rickylabs/orchid` (public, divybot single-file coordinator) at commit
`d344bd037bcf10150fd12daef8ffa277576cd94a`, read-only copy at
`rickylabs/orchid` source files `main.go`, `README.md`, `governor_test.go`, `divybot.example.json`; topic:
existing production governor; retrieved 2026-09-07]. Round 1 planned around the belief that no
governor existed. **One does, it is in production, and #63 says it "stays authoritative until the
port is at parity"** [observed — GitHub issue #63 body; topic: governor authority; retrieved
2026-09-07]. That inverts the plan: the job is no longer to synthesise governance facts from what
telemetry happens to have lying around — it is to **read the authoritative ones**.

---

## D-1 — Withdrawn: the transcript-derived producer and the `governance` subcommand

**Was:** round-1 decisions D5/D6 and slice S2 — build `governance-source.ts` to synthesise a
`GovernanceObservation` by mapping recovered codex `rate_limits` into `SubscriptionAccount`s and
summing recovered `usage.costUsd` per provider, exposed as a `dsh-telemetry governance` subcommand.

**Original rationale, preserved:** those readings are real values written by other systems, already
parsed at `packages/telemetry/src/backfill/codex.ts:73-89` and
`packages/telemetry/src/backfill/opencode.ts:58,125`, and nothing was consuming them at the
governance boundary. Building on them needed no host, no credential and no owner answer.

**Honest limits that withdrew it:**

1. **It is historical, not live.** A transcript's `rate_limits` block is a vendor statement recorded
   when the run wrote it; telemetry's own model says a quota reading "is only ever as fresh as the
   run that observed it" (`packages/telemetry/src/model.ts:62-66`). Presenting it as the live meter
   would be exactly the "fresh envelope over an old leaf" error the reviewer flagged separately.
2. **It cannot name an account.** Neither `source`+`limitId` (the reviewer's suggested key) nor
   `planType` distinguishes two accounts on the same vendor plan, and codex `session_meta` carries no
   account field. The orchid source shows the working solution: the coordinator **names accounts in
   configuration** (`main.go` `accountKey`, `Config.accounts`) and reads each account's meter
   directly. Deriving identity from a transcript key is not a weaker version of that — it is wrong.
3. **Summed run costs are not a ledger.** #64 requires an authoritative metered ledger; recovered
   per-call billing rows are not one, and `total_cost_usd` is SDK cost accounting rather than
   confirmed billed dollars (`packages/provider-claude/src/sdk.ts:160`).
4. **The coordinator ruled it out directly:** do not build a historical-cost CLI as a proxy for live
   authority.

**What survives:** nothing in the mutation surface. The recovered readings stay where they are, doing
what they already do — the legacy transcript quota line, which the shipped display already labels as
transcript evidence rather than governance (round-1 display plan, D7). If the source adapter is never
configured, governance stays `UNKNOWN/UNAVAILABLE` and that legacy line remains visible. That is the
honest floor, and it is already shipped.

---

## D-2 — Withdrawn: the `status`-only sidecar SDK in `packages/governance`

**Was:** round-1 decisions D9/D10 and slices S3/S4 — a data-in/data-out `sandboxctl status` reader in
`packages/governance`, wired so the answer became the capacity regime's host identity with `null`
bytes.

**Original rationale, preserved:** ADR 0002 authorises `status <project>` today, with no gate, and
building the authorised channel skeleton before activation looked like the correct sequencing. The
reviewer agreed it was not unused scaffolding, since the answer did enter the envelope.

**Honest limits that withdrew it:**

1. **`sandboxctl status` is not a governance envelope and must not be called one.** Its accepted
   definition is container and volume presence (`doctrine/decisions/0002-sandboxctl-execution-channel.md`,
   "The authority surface"). It carries no bytes, no account, no spend and no admission. Wiring it in
   would have added a host-identity row and nothing acceptance asks for.
2. **The coordinator ruled it out directly:** a status-only SDK with no consumer of its answer does
   not meet capacity acceptance, and the full path must enter the existing telemetry envelope
   carrying actual authoritative facts.
3. **It would have cost a package-graph edge for nothing.** A `telemetry → governance` import is a
   real workspace dependency: `packages/telemetry/package.json` dependencies, a `../governance`
   entry in `packages/telemetry/tsconfig.json` references, and `pnpm-lock.yaml`, all checked by
   `scripts/check-project-graph.mjs`. Round 1's claim that no graph change was needed was wrong, and
   the corrected answer is moot only because the import is gone.

**What survives:** the ADR reading itself, in `research.md` — capacity bytes have no authorised
source over that channel, and that remains the only genuine owner fork (F1).

---

## D-3 — Added: the read-only configured source adapter

**Is:** one adapter that fetches an **already-formed `GovernanceObservation`** from a configured
read-only source and hands the bytes, unmodified, to the parser that already ships
(`packages/telemetry/src/observations.ts:404-415`).

**Why this and not something larger:** every acceptance fact #205 asks for — per-account quota, a
provider ledger, host capacity, structured admission reasons with timestamps — is already a field of
that envelope, and the display for all of them is already shipped and independently PASSed. The only
missing link is transport. An adapter that re-derives, re-stamps, or re-decides anything would be a
second governance authority; an adapter that only *fetches and validates* cannot be.

**Why it is not a new outward protocol:** the envelope is the format `--observations` already
documents and accepts (`packages/telemetry/README.md:112`,
`docs/reference/cli/dsh-telemetry.md:41,50`). Reading it from a configured path or endpoint instead
of a hand-typed path adds a source, not a schema.

---

## D-4 — Reclassified: account labels, spend windows and validity

Round 1 raised these as owner forks F2/F3 and required an explicit `--valid-for`. All three are
withdrawn as design questions:

- **Account labels and source bindings are runtime configuration.** The orchid source demonstrates
  the shape (named accounts, per-host meter scripts, `divybot.example.json` `governor` block).
- **Spend windows likewise.**
- **Validity is not ours to set at all.** The envelope carries its own `observedAt`/`validUntil`; the
  adapter preserves both byte-for-byte and stamps nothing. Round 1's "required validity duration with
  no default" was correct for a producer and is meaningless for a reader.

## D-5 — Moot: whether a refused dispatch may become an admission (round-1 fork F4)

An authoritative governor produces admission decisions with a binding window and a state
(`main.go` `govDecision`, `decide`). Once those arrive in the envelope there is no reason to infer an
admission from provider-refusal prose, and D7's prohibition on doing so stands unchanged. The fork is
withdrawn as unnecessary rather than answered.

## Fork count

Round 1: F1–F5. Round 2: **F1** (authorised source for host capacity bytes) and **F5** (activation).
F2/F3 became configuration (D-4), F4 became moot (D-5).

---

# Round 2, in-flight amendment — owner answer names the data source

**Cause of drift.** Still round 2; this is an in-flight repair, not a new round. The owner superseded the pending factual question with two answers: the netscript agentic
harness already ships most of what is needed, and its toolchain may be run against real runs on other
authorized projects, which between them cover all four runtimes (codex, claude, opencode and agy)
[owner — harness coordination; topic: governance data source; 2026-09-07]. Project names and storage
locations are deliberately not reproduced in this artifact.
Source authority verified at upstream HEAD `8ba53bc50ca02aab29e99ba5362728839b8f1713`, read-only
checkout `refs/netscript`. Read-only inspection of real
runs was authorized. Nothing below restarts the plan; prior drift stands unedited.

## D-6 — Withdrawn: the generic `https:` source descriptor

**Was:** round-2 D6/D13 — a configurable `https` descriptor with method, timeout and byte cap, whose
wire contract was explicitly provisional pending an endpoint answer.

**Original rationale, preserved:** with no named source, a validated, credential-safe, refusal-first
descriptor was the most that could be specified without inventing a deployment.

**Why withdrawn:** the answer arrived, and it is not an endpoint we configure — it is an existing
toolchain we invoke. A generic HTTPS client aimed at an unnamed URL is the "arbitrary endpoint stub"
the coordinator ruled out. The concrete integration is `deno task agentic:expense-watch` and
`deno task agentic:routing-state`, whose own permission grants bound them
(`deno.json:79,81` of the authority checkout).

**What survives:** the URL refusal grammar and the credential rules are no longer ours to apply —
`fetchOpenCodeGoUsageSnapshot` performs the authenticated read behind the boundary
(`provider-usage.ts:138-176`), and we never see the credential. The `file:` source survives for
offline tests and captured fixtures. The error/refusal discipline survives verbatim as the
subprocess-boundary policy (amended D16).

## D-7 — Reversed: an inward mapping is required, not forbidden

Round-2 D1 forbade "an adapter that maps a source-specific payload into the envelope", on the ground
that a translator is a second schema authority. That reasoning was correct for an unnamed endpoint
and is **wrong for netscript**, because ratified decision 2 requires exactly that shape: netscript
"stays a service behind an adapter, not a build-time dependency" (`AGENTS.md:99`).

The distinction that makes this safe, and which round 2 conflated: a **new outward protocol** is one
this repository publishes for others to implement. An **inward adapter** consumes an existing
service's existing output and produces telemetry's existing internal envelope. Nothing new is
published; `packages/contracts` is untouched. Amended D14 states the boundary explicitly, and the
"no new outward protocol" constraint is unchanged.

## D-8 — Withdrawn: `--observations-token-file`

Round-2 D7 had telemetry read a token file and place a bearer header. Under the netscript boundary
this repository handles **no credential at all**: `agentic:expense-watch` resolves its own via
`environmentWithOpenCodeCredential` (`provider-usage.ts:143-149`) and is granted
`--allow-read --allow-env --allow-net=opencode.ai` and **no** `--allow-write` and **no**
`--allow-run` (`deno.json:81`). The strongest available credential guarantee is therefore structural
rather than behavioural, and it is better than the one round 2 designed. The canary survives, pointed
at the boundary instead (amended L18).

## D-9 — Superseded: "no producer exists for quota"

Round 2 concluded that quota's only authoritative producer was the external divybot governor, and
that spend and capacity had none anywhere. The first half is superseded: **a second, closer,
authenticated producer exists** — `fetchOpenCodeGoUsageSnapshot` reads live subscription windows with
provider `resetsAt`, and `evaluateSubscriptionExpense` returns a structured allowance verdict with a
closed reason enum and fail-closed staleness (`subscription-expense.ts:59-77`, `:142-160`).

The second half **stands, and is now confirmed twice over**: there is no metered *billed spend*
producer (percentage-derived `usedUsd` is allowance accounting — `subscription-expense.ts:117-127`),
and a search of the whole authority checkout for any memory or GPU reader returns nothing, so host
capacity bytes have no producer in netscript either. Owners remain #64 and #65.

Divybot remains the authoritative *governor* under #63; netscript is the authoritative *reader* this
plan integrates. They are not in competition: this repository still decides nothing (amended D19).

## D-10 — Corrected in flight: five claims withdrawn after coordinator review and three live receipts

Recorded as corrections rather than edits, so the wrong version stays visible.

1. **Operational counts and a project identity were published.** The earlier real-run table gave exact
   file counts and named a target project. Withdrawn and replaced by a boolean coverage receipt. The
   rule is that raw telemetry, exact operational counts and private project identities stay out of
   artifacts and reviewer payloads; the earlier table broke it.
2. **Routing state was mapped to admissions.** `RoutingState` is a routing transition, not item-scoped
   refusal evidence: `affectedSession` is a session rather than a work item, and a session quota
   transition can be detected after the effect it describes has begun. The mapping is withdrawn with
   no fallback; admissions stay `unknown` unless an actual decision was recorded (D20).
3. **`expense-watch` was said to emit `ExpenseUsageSnapshot`/`capturedAt`.** It emits an
   `ExpenseDecision`, which has none (`runtime/subscription-expense.ts:70-78`); `snapshotAgeMs` is a
   duration, not a timestamp. Withdrawn — the library is called behind an injected adapter instead, and
   no timestamp is reconstructed from an age.
4. **A subprocess was treated as a boundary around a prohibited path.** `agentic:routing-state` reads
   `~/.config/netscript-agentic/runtime`; invoking a helper that reads it does not make the read
   permitted, and it is a different act from a previously authorized provider launcher running
   natively. That task is excluded. The replacement is an env-injected, file-denied adapter — which the
   live receipt then proved works.
5. **"No capacity reader exists anywhere" was a global absence claim from a sparse checkout.** Only
   `.llm` directories are populated, so the honest statement is "no byte reader identified within the
   scanned path". The "three-way confirmation" phrasing is withdrawn.

## D-11 — Reversed by receipt: two "not buildable" conclusions

- **Quota needs no auth-file access.** `fetchOpenCodeGoUsageSnapshot` ran with a process-injected
  `OPENCODE_API_KEY`, `--allow-env` + `--allow-net` only, no `--allow-read`, and `readTextFile`/`stat`
  rejected — exit 0, three finite windows, valid capture stamp. `resolveCredential` takes the
  environment value first (`lib/provider-credential.ts:78-79`), which is why. The earlier
  missing-credential inference is withdrawn.
- **Metered spend is reachable.** OpenRouter's current-key endpoint returned finite total and
  current-month usage in USD under an env-injected credential with no file access. The earlier "no
  billed-spend producer, not buildable" claim — carried since round 1 — is withdrawn. Spend is now leg
  B, not an open owner dependency.

## D-12 — Withdrawn: the capacity owner fork

Reading the **current cgroup's** memory at an explicitly declared scope needs no new authority, so
pure collection does not warrant a policy fork. A physical-host figure is a different, unestablished
scope and is reported `unknown` rather than raised as a decision; `os.totalmem()` is never used and no
reading is labelled as a host. Forks reduce to a single owner **permission** (P1, data scope), asked
after the buildable work is green.

## 2026-09-07 — interrupted review and bounded coordinator repair
The same GLM reviewer stopped producing output without a verdict; launcher interrupted rather than treated as PASS. D24 corrects envelope/leaf time ordering, invented binding policy, log envelope runId, spend mapping, explicit cgroup scope, incomplete exit semantics and unnecessary permission request. Existing source capture receipts remain reachability evidence only. Resume the same reviewer with a fresh matrix CLI receipt, no model fallback.

## Plan gate disposition — 2026-09-07

All six plan-eval.md implementation notes accepted. D24 supersedes earlier exit0, arbitrary HTTPS URL, inferred binding/window duration and v1 fallback shorthand. render.ts mutation surface includes partial known-used/unknown-total capacity, not only D12 leaf freshness. Only total/monthly spend were receipt-observed; omitted daily/weekly values fail unread. No scope expansion beyond truthful source composition.

## 2026-09-07 — implementation dispositions within D24

- The owner assigned S6 live integration, publication and independent evaluation to the coordinator.
  This implementation session stops at tested offline handback, with no live-acceptance claim.
- The external Deno imports use static aliases resolved by an in-memory import map, keeping operational
  checkout selection outside the Node project and avoiding a dynamic file-import permission expansion.
  `DENO_DIR=/dev/null`, disabled config/lock discovery and disabled code caching preserve observation
  immutability. Synthetic restricted-launch smoke passed; upstream live integration remains unrun.
- D23 privacy requires withholding free-form admission operator detail and approval payloads after
  validating the complete detail with the existing parser. Fixed public detail explicitly says it was
  withheld. Closed reason, item, decision state/timestamps and reader provenance remain. Private detail
  differences still cause same-time conflicts before redaction; log identity never becomes execution.
- Live-source admission receipts are excluded from the CLI's run-event merge. Otherwise the existing
  merger counted a valid admission-only receipt as an unidentified run and made the scan incomplete.
  The legacy file-mode merge is preserved. This is admission normalization, not routing policy.
- JavaScript date normalization is rejected at the live edge: impossible calendar dates and 24:00
  cannot become an explicit valid decision timestamp. File-mode parsing is unchanged.
- `check:metadata` was attempted in the credential-free temporary-home validation environment and
  returned exit 3 (no usable GitHub transport; nothing compared). It is unverified, not a pass; an
  authenticated comparison remains for the coordinator. No authfile was opened to retry it.

Evidence: `implementation.md`; code and tests are enumerated in `implementation-surface.json`.
No new owner fork, dependency, route policy, contract, governance stub or workflow was introduced.

## Coordinator implementation corrections — 2026-09-07

The earlier closed-reason wording was found inconsistent with published DispatchOutcome examples (routes.ts:106-110). No new vocabulary is owned here: bounded public-safe machine-code syntax replaces the invented enum, with semantic/content responsibility on the producer. Tests preserve documented and future codes, and reject prose/paths. The probe now validates and copies every stdout field after a private-status canary reproduced leakage. verify-probe.mjs is an executable offline run receipt; it requires Deno explicitly and does not add Deno to the Node test/build graph. Both corrections and actual gates are in verification.md.
