# Native envelope compatibility evaluation (plan-only)

Verdict: **PASS**

Summary: the amendment recognizes exactly two newly observed native envelope types
(`world_state`, `token_usage_record`) as input vocabulary only — no wire/schema,
output-key, ownership, or scope-rule expansion. Against the round-3 baseline it is
monotonic in strictness: every previously readable file reads identically, and
previously refused files containing exactly these two well-formed kinds may now read
only subject to all prior gates (F1–F7, C1–C7, R1) plus the new ones below. Three
narrow in-flight binding repairs (R2–R4) are locked here; no re-review needed. All
gates/fixtures remain proposed, NOT RUN. Prior verdicts preserved: round 1 `FAIL_FIX`
(`plan-eval.md`), round 2 `PASS` (`plan-eval-round2.md`), round 3 `PASS`
(`plan-eval-round3.md`). No product mutation, no test certified, no publication claim,
no private source scanned.

## Empirical basis (accepted as stated, not verified)

Coordinator-reported authorized real gate encountered `world_state` and
`token_usage_record` alongside `event_msg/token_count`. Real event counts and run
identities are omitted from this public copy. Current strict reader refuses with unknown-envelope, run null —
consistent with the checkout, where `KNOWN_TYPES` holds exactly the five old members
(`packages/telemetry/src/backfill/codex.ts:38-44`) and unknown envelopes are tallied
into the withhold path (`packages/telemetry/src/backfill/codex.ts:122-124`). Raw
evidence stays private outside the repo; public fixtures must be synthetic
shape-equivalents only. No vendor-wide completeness is claimed — correctly withheld.

## A. `world_state` — PASS with R2

Direction is right: `full === true` plus a fully-shaped, nonempty environment map is
required; anything partial (`full: false`, missing/malformed/empty structure) withholds
as `incomplete/invalid-evidence`; per-record cwd containment is enforced with the
unresolved/outside split (`scope-unverified` / `scope-mismatch`); session_meta positive
cwd stays mandatory and `world_state` never substitutes for it; instructions/model/
settings are neither imported, exposed, nor used for identity/accounting; no prose
parsing or recursive mining; unknown/partial layouts withheld.

In-flight repair R2 (locked): exact envelope type `world_state` (case-sensitive);
`payload.full === true` strict boolean; `payload.state`, `state.environments`, and
`state.environments.environments` each plain objects, env map with ≥1 own key;
every environment record validated independently — record non-object or cwd key
absent/non-string/empty/relative ⇒ `incomplete/invalid-evidence`; absolute but
unresolvable ⇒ `scope-unverified`; resolving outside the selected worktree after
symlink-resolving canonicalization (same rule as v2 F5) ⇒ `scope-mismatch`; every
present `world_state` envelope validated with worst-by-F1-precedence winning. Exact cwd
key is `cwd`; if the pinned source shows a different key, that is a plan deviation
requiring re-review, not a silent substitution. No other `world_state` field is read,
exposed, or logged (see R4).

## B. `token_usage_record` — PASS with R3

Direction is right: corroboration-only identity check (both `payload.thread_id` and
`payload.session_id` present, R1-charset per
`packages/contracts/src/governance-read.ts:65,67,117-121`, both equal the F6-established
selected ID, else `identity-mismatch`); session_meta mandatory (token-only file ⇒
`identity-missing`); sole accounting source stays `event_msg/token_count` cumulative
totals (`packages/telemetry/src/backfill/codex.ts:157-177`), never summed, never
double-counted; no leaf-time refresh; `turn_id`/`root_turn_id`/`response_id` never
output or ancestrally inferred.

In-flight repair R3 (locked): total-ignore guard — no payload field other than the two
IDs influences any output, timestamp, or decision, and the README/handoff documents
exactly that plus the unvalidated-supplemental-block limitation. Count agreement
between token records and `token_count` events is explicitly NOT cross-validated: a
fidelity note, not a binding gate, since binding (identity + scope) never depends on
counts and every line still passes malformed/unknown/identity/scope/timestamp checks.

## C. Timestamps — PASS with R4 (first half)

`world_state`/`token_usage_record` envelope timestamps join the F2-validated,
nondecreasing stream and may extend first/lastObservedAt; they never restamp
model/provider/usage/execution leaves and assert no liveness. R4a (locked): only
`envelope.timestamp` participates — inner payload times, if any, are ignored entirely.

## D. Gates and anti-overfitting — PASS

Fixture list covers valid-full, outside/unresolved/malformed/missing/empty/full-false
world states, world-state-without-session_meta, token equal/wrong/missing/malformed
IDs, no-double-sum, token-only accounting unavailable, no leaf-time refresh, and
third-envelope refusal — the right matrix through the actual-CLI → packed-installed-decoder
path. "Retry unchanged real source only after reviewed implementation + synthetic
gates; preserve initial refusal; never filter real data to force pass" is the correct
discipline against fitting fixtures to the observed file. Supported vs. unsupported
(partial world update) forms documented in producer README/release handoff.

In-flight repair R4b (locked, privacy): no `world_state`/`token_record`-derived
strings — environment IDs, cwds, instructions, settings, non-echoed IDs — appear on
stdout/stderr or in notes; fixed codes only. The allowlisted nativeId echo and F7
canary rule (`scripts/check-installed-contracts.mjs:174,190-191` pattern) extend to the
new envelopes unchanged.

## Adversarial sweep (no further blocker)

- Scope smuggling via env map: every record inside-or-withhold, plus mandatory
  session_meta cwd, plus every-present-cwd rule — a cross-repo line anywhere withholds
  everything. New envelopes add assertions; they remove none.
- Identity smuggling via token records: dual-ID equality against the selected ID;
  mismatch withholds rather than reassigns; tuple identity (C1) keeps two stores with
  identical run IDs distinct regardless.
- Scope signal hiding in ignored numeric blocks: accepted limitation under the
  total-ignore guard; identical posture to unmined `event_msg` tool payloads, so no new
  hole relative to baseline.
- Liveness/freshness laundering: no new clock, no leaf refresh, verification root
  (C3) and race algorithm (C4) untouched; exit mapping stays incomplete ⇒ exit 3 per
  `packages/telemetry/src/cli.ts:133`.
- Wire expansion: output keys, coverage union (+`binding-changed`), verification root,
  and decoder strictness all unchanged; the two names extend input vocabulary
  (`KNOWN_TYPES`) only, and any third envelope still refuses.

## Gates (proposed, NOT RUN, not certified)

Section-D matrix plus round-2/round-3 matrices, actual source-pinned CLI through the
exact packed offline installed root decoder/types with `/server` compatibility and
extended privacy assertions, then retry of the unchanged real source privately outside
every repository. Release-`5766675` vs inspected-`e924b34` product equality still must
be verified before implementation, now including confirmation that the pinned source's
reader refuses the two new envelopes.
