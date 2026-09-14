# Plan — draft, awaiting independent evaluation

Add the missing I1 receipt validator and CI gate, then close the blocked-decision check gap; prepare
the before-spawn integration against the actual divybot source; measure consultation before
promoting it. Profiles stay markdown. No product code changes before stages F–G pass.

## Decisions

1. Preserve the charter's authority and executor boundary. The matrix CLI is consumed in place;
   replacing divybot or extracting NetScript is rejected (`ARCHITECTURE.md:238–257`).
2. Extend the existing cluster validator, with an executable Node/pnpm test path. Do not create
   a second cluster validator or a second decision store. Use the existing reporting decision
   collection as a projection of decision records (`research.md`, repository evidence).
3. For blocked reporting lanes require `decisionRef` to resolve exactly once to a record with
   `status: open`, the same lane, a question, at least two nonblank options, recommendation,
   cost of being wrong and raised timestamp. Reject missing, closed, malformed, ambiguous and
   wrong-lane references. Apply the same rule to blocked leaves via their lane. A schema-1
   blocked leaf cannot evade the check by omitting reporting. Historical nonblocked artifacts
   remain compatible. Existing reporting-only records without new fields remain accepted
   when they are not used to satisfy I4; they cannot prove a blocked state.
4. Change path imports in validator/renderer to Node's compatible `node:path` so Node 24 can
   import and exercise the existing TypeScript functions. Keep Deno CLI behavior. Unit tests
   must also invoke the full validator with a nonempty synthetic inventory and real renderer,
   plus a controlled PR source, so dead wiring cannot pass. No Deno build dependency is added.
5. Dual-agent exchanges remain advisory unless an independently evidenced evaluator assignment
   establishes role, matrix selection and family/session separation. A counterpart's history
   or agreement is not a sign-off. The pilot does not implement dispatch, an event store or a
   second answer authority (`ARCHITECTURE.md:148–165`, `:169–190`).

6. Add a portable receipt checker under `.llm/tools/harness/`, with a root pnpm command and
   tests. Required `requested` and `observed` envelopes each carry model, effort, transport,
   role and tier. Requested values are nonblank. Observations distinguish known from unknown,
   with evidence kind and reason; unknown must yield unproven rather than pass. A resolution
   includes source identity/digest, selected candidate and time. Public fixtures are synthetic.
   Missing receipt arguments, no files, empty arrays, unsupported schema and malformed inputs
   are nonzero. The checker reports only fixed field paths and verdicts, never input values or
   source paths. It must distinguish invalid from unproven and never rewrite historical receipts.
7. Do not describe receipt structural validation as launch authorization. I1 validator tests
   prove the schema and its verdicts, not that every dispatcher branch writes a receipt. I2/I3
   integration stays at divybot's resolver/launcher boundary and remains unproven here until that
   reviewed integration runs. Avoid duplicating fleet policy in a standalone schema checker.

## Execution slices

1. I1 receipt checker, tests, and pnpm/CI reachability. One standalone implementation PR; exact shape and verdicts in `receipt-contract.md`.
2. I4 validator linkage and its integration tests. Separate follow-up PR after its plan gate.
3. Before-spawn divybot integration. Separate downstream PR and live acceptance.
4. Dual-agent draft and observations. Owner promotion remains independent of code slices.

## Owner forks

1. **Open; blocks promotion only.** Should dual-agent consultation become a supported Harness
   capability? Options: retain an operator experiment; standardize a thin mailbox adapter after
   successful measured use; build a shared service now. Recommend the thin adapter only after
   successful correlated responses and restart/replay evidence. Cost if wrong: premature schema
   and lifecycle commitments around an unproven workflow. Current authorization permits the
   experiment and draft design, not a claim that promotion has been decided.

2. **Open; blocks source mutation.** Which authorized independent evaluator will perform the
   plan gate for the I1 slice? Options: provision the route selected for the agreed tier; supply
   evidence that an existing assigned evaluator can perform it; record an explicit named route
   override while preserving different-family/session independence. Recommend making the
   selected route executable; cost if wrong is additional delay, versus an unaudited weaker
   gate. The counterpart is advisory and has been asked to escalate assignment; no override is granted.

## Spikes and gates

- Live matrix resolution, physical model mapping and authority export: obtain fresh CLI output;
  never infer logical-to-physical mappings or entitlement from model names.
- Every-spawn coverage: enumerate initial dispatch, comment mirrors, continuation and retry
  reachability in divybot. Resolver failures, malformed/empty JSON, authority refusal and
  evaluator family mismatch must prevent the spawn effect. Receipt persistence must precede
  the effect; observed values require launcher/control-plane evidence after it.
- Local I4 gate: Node tests include a valid nonempty cluster and deliberate negative mutations.
  Root `pnpm test` must execute them; typecheck/build/test remain the repository gate.
- Independent plan evaluation and exact-head implementation evaluation: pending; never authored
  here as PASS. Matrix-authorized assignment must be evidenced before any new evaluator spawn.
- Live dispatcher acceptance and all-launcher I1–I3 coverage remain unproven until downstream
  integration executes. A local schema test cannot prove a remote hook is installed.

## Dependency DAG

Research → independent plan evaluation → I4 validator/tests → repository gates → independent
implementation evaluation → supervisor sign-off. In parallel, read-only divybot discovery →
fresh matrix CLI evidence → reviewed dispatcher plan → integration and receipt validation →
controlled live acceptance. Dual-agent measurements → owner promotion decision, independently.

## Risk register

| Risk | Likelihood / impact | Gate |
| --- | --- | --- |
| Stale reporting or a closed decision satisfies I4 | high / high | negative full-validator tests |
| Schema 1 evades I4 | medium / high | blocked legacy fixture |
| Pure helper passes while integration is dead | medium / high | remove call and prove red |
| Model resolution mistaken for executability | observed / high | refusing-launcher acceptance |
| Receipt schema passes with no launch coverage | high / high | explicit coverage inventory and live gate |
| Consultation mistaken for review authority | high / high | independent assignment evidence |
| Private operational data reaches public artifacts | medium / high | staged-diff publication review |

## Review-assignment disposition

The isolated I1 implementation was classified as feature work on its bounded scope and the
fresh CLI description, with the counterpart concurring. That row already supplies independent
candidates. Owner fork 2 therefore needs no route override for I1; its remaining obstacle is
technical admission/receipt evidence, not permission to invent a reviewer. The wider
architecture plan still has no authorized evaluation. See the withdrawal in `worklog.md`.

The selected primary's Go admission was refused in the counterpart's diagnostic. Issue 340
was withdrawn without a review result. A next attempt may use only the matrix's declared
candidate with fresh resolution and admission evidence. No public issue state proves that an
already accepted runtime stopped; dispatcher-side cancellation confirmation remains unproven.

## Current slice disposition

Owner fork 2 no longer blocks I1: the existing feature fallback was admitted and the independent
plan gate passed with all narrow fixes incorporated. I4 obtained its own independent plan gate.
Their locked plans and executable checks now live in PRs 342 and 345. This broader plan remains
draft for actual dispatcher integration and dual-agent promotion; neither local check establishes
all-launcher enforcement. See context-pack.md for current pinned review heads and outstanding work.

## Upstream owner forks — raised by independent plan review 347

3. **Open; blocks Orchid implementation. Observation and evaluator bootstrap.** Which trusted
   source should supply the generator's actual launched model and model-session identity?
   Current divybot AgentInfo and observed control-plane list/get fields supply neither. Options:
   (a) implement the matrix hook for non-evaluation work first and refuse evaluator admission until
   the control-plane/cockpit lane supplies a bound observation contract; (b) authorize a separately
   reviewed native-runtime observation adapter now, reusing first-party NetScript capabilities where
   present, then integrate its real receipts. Recommend (a): preserve unknowns and keep the hook
   bounded; do not fabricate receipts for pre-hook generators. Cost if wrong: automated evaluation
   remains unavailable longer. Option (b) costs another integration and transport-specific evidence.
   A model-session identity is not a pane/workspace handle. No option waives I2.

4. **Open; blocks Orchid implementation. Explicit free-mode pin semantics.** When a brief pins a
   declared fallback model while the primary has not been shown unavailable, should dispatch refuse
   unless there is a trusted owner override, or should the pin itself select that declared fallback?
   Options: (a) pins constrain the normal resolved route; selecting a different route requires the
   existing first-party OwnerMatrixOverride with trusted owner provenance, rationale and worklog;
   (b) any pin to a declared candidate selects it without separate primary-unavailability evidence.
   Recommend (a), preserving primary/fallback semantics and the existing owner-override mechanism.
   Cost if wrong: stricter metadata and migration for current free-mode briefs. Option (b) is easier
   operationally but lets a pin skip the matrix's preferred route; it still must never waive I2/I3
   or profile restrictions. The charter preserves free mode but does not settle this precedence.

Review: https://github.com/rickylabs/harness/issues/347#issuecomment-5661595770
The six non-owner corrections are incorporated in dispatcher-plan.md. This is the concrete plan
being offered for decision, not a request to approve an unspecified future design.
