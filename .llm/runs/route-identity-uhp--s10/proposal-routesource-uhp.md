# Contract-change proposal — `RouteSource` for UHP

**Deliverable 2 of Spike S10** ([#288](https://github.com/rickylabs/harness/issues/288)).
Status: **proposal, not applied.** Target implementer: [#286](https://github.com/rickylabs/harness/issues/286).

---

## 1. The question, answered

> Either `RouteSource` grows a UHP arm, or every UHP route is unverifiable by construction. Decide
> which and say why.

**Decision: `RouteSource` grows a UHP arm — but a narrow one, covering only `model`, and it does
not by itself make any UHP route verifiable.**

The dichotomy in the brief has a false floor. Both halves are true at once:

- `RouteSource` **should** grow a UHP arm, because the current predicate is genuinely defective and
  would reject correct UHP evidence for the one field UHP does report.
- Every UHP route **remains** unverifiable afterwards, because three of the four route fields have
  no UHP wire representation at all (`research.md` §2, §3, §4).

The arm is worth adding for honest provenance and honest diagnostics. It is worth adding **only** if
nobody reads it as unblocking certification. That is why this is a proposal with a stated blast
radius rather than an edit.

## 2. Is the UHP arm additive?

**Yes, additive, and not a breaking change to any published package.** Stated plainly, as asked, with
the three separate things that could have made it breaking checked one at a time.

| Concern | Finding |
|---|---|
| Does it break `packages/contracts`, the published package? | **No.** `packages/contracts` carries no reference to `RouteStatus`, `RouteSource`, `RouteIdentityEvidence` or route identity in any form, and has no dependency on `@rickylabs/subagents`. Its `src/routes.ts` is the unrelated HTTP command surface. |
| Is `@rickylabs/subagents` itself published? | **No.** `packages/subagents/package.json` declares `"private": true`. |
| Does widening the union break a consumer? | **No consumer exists to break.** `RouteSource` is exported at `packages/subagents/src/index.ts:124` and imported **nowhere** outside `route.ts` and `index.ts`. |

The general rule, for the record, because it is the reason this question is worth asking rather than
assuming: adding members to an exported string-literal union is additive in **producer** position
(every existing value stays valid) and **breaking** in **consumer** position (an exhaustive `switch`
with a `never` default stops compiling). `RouteSource` appears in consumer position in exactly one
place — the `source` field of `RouteValueEvidence`, which is compared by equality at
`route.ts:180-181`, never switched over exhaustively. So the widening is safe today, and the reason
it is safe is checkable rather than assumed.

**One caveat that is not a blocker but must be said:** the arm is safe *because* nothing consumes
`RouteSource` exhaustively today. If #286 or Atelier Cockpit later introduces such a switch, this
union becomes breaking-by-extension and each future dialect is a semver event. Better to decide now
that `RouteSource` is an open-ended enumeration by design and that no consumer may switch
exhaustively over it.

## 3. What the change actually is — and it is two parts, not one

The brief frames this as one change. It is two, and only the second one has design cost.

### Part A — the vocabulary (trivial, additive)

Add to `RouteSource` at `packages/subagents/src/route.ts:14-22`:

- `"uhp/responses.result.model"` — sourced from `Response.model`, `openapi.yaml:836`, required by
  `openapi.yaml:823`, "The model that actually ran".

And, for diagnostics only, optionally:

- `"uhp/responses.result.requested_model"` — sourced from `Response.metadata.requested_model`,
  `openapi.yaml:852-854`, present only on substitution.

**Deliberately NOT added: `uhp/…effort`, `uhp/…cwd`, `uhp/…provider`.** This is the load-bearing half
of the proposal. There is no UHP wire field for any of the three (`research.md` §2–§4). A provenance
label names *where a value came from*. Minting a label for a field the protocol cannot report creates
a name with no referent, and a name with no referent is the precise shape of the fabricated
agreement this contract exists to prevent — it invites a future implementer to populate it from
something adjacent-looking and plausible. The absence of a label is the honest encoding of
"unobservable", and `RouteValueEvidence` already has the right representation for it: `value: null`
against the *requested*-side source, which is what `compareRouteIdentity` produces today with no
change at all.

### Part B — the predicate (the real work)

`OBSERVED_SOURCES` at `route.ts:65-70` is a single module-level
`Readonly<Record<RouteField, RouteSource>>`, and `isRouteEvidenceVerified` demands exact equality
against it at `route.ts:181`. Part A without Part B is inert: a `uhp/responses.result.model` label
would still be rejected, because it is not the `thread/start.result.model` the map hardcodes.

Part B means `OBSERVED_SOURCES` becomes **per-dialect**: a map from a protocol dialect to its
observed-source map, with `compareRouteIdentity` and `isRouteEvidenceVerified` selecting the dialect
rather than assuming one. Shape sketch, not a signature to copy:

- `OBSERVED_SOURCES` becomes `Readonly<Record<RouteDialect, Readonly<Record<RouteField, RouteSource>>>>`
  with `RouteDialect` = `"codex" | "uhp"`.
- `compareRouteIdentity` takes an optional third argument defaulting to `"codex"` — additive, so
  every existing call site at `provider-codex/src/protocol.ts:172-219` and
  `dsh-app/src/dry-run-internal.ts:93` keeps compiling unchanged.
- `isRouteEvidenceVerified` accepts a `source` whose label matches the dialect map **for the dialect
  that label belongs to**, rather than one global map. It must not become "any label in the union",
  which would silently accept a codex label on a UHP route and lose the cross-dialect guard the
  predicate currently provides for free.

Part B is the part that could go wrong, and the way it goes wrong is by loosening into
`ROUTE_SOURCES.includes(source)`. Any implementation in #286 must be reviewed against that specific
loosening.

## 4. Owner fork — may `Harness.base` be read as `provider`?

Filed per the standing constraint "no silent owner decisions" (`AGENTS.md`, Standing constraints §2),
because this is a question about what the owner wants the word `provider` to mean, not about what is
true.

**Question.** UHP has no `provider` field, but it does have `Harness.base` (`openapi.yaml:645-652`),
an opaque string with examples `codex`, `claude-code`, `hermes`, obtainable from the harness object
that `metadata.harness_id` selects. Should #286 populate the `provider` observation from `base`?

**Options.**

1. **No.** `provider` stays `null` over UHP. Every UHP route is `unknown`. (Recommended.)
2. **Yes.** Read `base` as `provider`, via a fetch of the harness object. Three of four fields become
   two of four, and routes are still `unknown` — so it buys nothing today, and buys a false positive
   the day `effort` and `cwd` become observable.
3. **Redefine.** Change what `ROUTE_FIELDS.provider` means, from "who served the tokens" to "which
   harness base ran", repo-wide.

**Recommendation: option 1.** `base` is the *harness* identity — which agent CLI is running — and
`provider` in `ROUTE_FIELDS` means the *model provider*. They are routinely different: a
`base: "codex"` harness pointed at an Anthropic model would report `codex` and satisfy a check that
was asking who served the tokens. UHP itself forbids the reading, `harnesses.md:65-69`: a client
"MUST treat `base` as an opaque string". An opaque string is not an identity to compare against a
requested provider.

**Cost if wrong.** Low and recoverable. Option 1 refuses routes that option 2 would have admitted.
Since all UHP routes are refused anyway under `research.md` §7, the practical cost today is zero;
the cost arrives only if UHP later gains `effort` and `cwd`, at which point choosing option 2 now
would mean a provider check that has been silently comparing the wrong noun for months.

## 5. Why this is not applied in this spike

Four reasons, in descending order of weight.

1. **It would add vocabulary with no producer.** #286 owns `provider-uhp` and this spike is forbidden
   from implementing it. A `uhp/responses.result.model` literal in a union that nothing emits is
   dead contract, and dead contract is how a vocabulary drifts from what the wire does.
2. **Part B is a behaviour change to a verification predicate**, which is the single most
   safety-critical function in the package. It deserves its own diff, its own review and its own
   regression suite, not a spike's incidental edit.
3. **It changes nothing about the gate.** Applying both parts today leaves every certification lane
   in `research.md` §8 exactly as refused as it is now. A change that alters no outcome but touches
   the safety predicate is pure risk.
4. **The information the owner needs is the decision, not the diff.** Deliverable 2 asked for a
   decision written as a proposal. This is it.

## 6. Acceptance criteria for #286, when it applies this

Carried forward so the proposal is executable rather than advisory:

- [ ] `RouteSource` gains `"uhp/responses.result.model"`, and no `uhp` label for `effort`, `cwd` or
      `provider`.
- [ ] `OBSERVED_SOURCES` becomes dialect-keyed; `compareRouteIdentity` gains an **optional** dialect
      argument so existing call sites are untouched.
- [ ] `isRouteEvidenceVerified` still rejects a codex-dialect label presented on a UHP route. The
      loosening to "any member of the union" is explicitly out.
- [ ] The tripwire test added by this spike —
      `packages/subagents/src/route.uhp.test.ts`, "the current predicate rejects UHP provenance" — is
      **updated deliberately, not deleted**, and its replacement asserts the new dialect rule.
- [ ] The owner fork in §4 is ratified before any `provider` observation is populated over UHP.
- [ ] `research.md` §5's recommendation on the `model_fallback` trigger is honoured: refuse on
      `requested_model` present-and-differing **or** `model_fallback` truthy, keeping presence as the
      fail-closed reading until a live router is observed.
