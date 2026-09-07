# Adversarial plan evaluation — `route-identity--e35` (#195)

**Verdict: PASS AFTER NARROW FIXES**

The slice is correctly scoped and honest about being a gate primitive only. `unknown` never permits a send and is never retryable; mismatch refuses unconditionally with no bypass. The defects below are all textual/spec defects in the locked plan, fixable without rescoping. Findings 1–5 are blocking (they can produce a gate that is unsound or untestable as written); 6–11 are required-but-cheap; 12–13 are advisory.

## Blocking

**1. Request-id ownership is self-contradictory, which voids the correlation guarantee.**
`plan.md:62-64` says the injected port's "request method supplies a unique id and returns the raw correlated response," and in the same breath that "the helper checks exact id." If the *port* mints and correlates the id, the helper has nothing independent to check, the "wrong response id returns `unknown`" test (`plan.md:160`) only exercises a fake that voluntarily lies, and the concurrency property (`plan.md:161`) is delegated to transport code that #53 has not written. Fix: state that the **helper** mints the per-call id, passes it in the request, and the port returns the raw response unfiltered; the port's contract is transport, not correlation. Then `plan.md:161` and the wrong-id case test something real. As written this is the difference between a gate and a decoration, and `plan.md:214` already rates wrong-correlation as Critical.

**2. The plan never names the observed response key for effort, and the request/response keys differ.**
`protocol-schema.md:24` declares `reasoningEffort: ReasoningEffort | null` on `ThreadStartResponse`, while the request carries effort at `config.model_reasoning_effort` (`plan.md:65`). `plan.md:64` only says the parser "reads the four top-level response fields." An implementer working from `plan.md` alone can plausibly read `config.model_reasoning_effort` off the response — yielding permanent `unknown`, or, worse, reading the caller's own request object and echoing it. Only `research.md:88` names `result.reasoningEffort`, and research is not the locked contract. Fix: name all four exact observed keys (`model`, `modelProvider`, `cwd`, `reasoningEffort`) and the exact request keys in `plan.md` D-5, and add a test asserting the observed effort is read from the response key, not the request key.

**3. No gate on effort/provider *vocabulary* equivalence, under a no-normalization rule.**
D-2 (`plan.md:40-43`) mandates exact string equality with no case folding or aliasing. The requested effort originates in the dsh routing matrix vocabulary; the observed effort is Codex's `ReasoningEffort` enum (`protocol-schema.md:24`). If those two spellings differ at all, the gate refuses 100% of live dispatches — a fully closed gate that looks correct in unit tests because both sides are fixture strings. The same applies to the requested `modelProvider` config id, whose only stated producer is "provider composition" that D-7 explicitly does not ship. This unverified claim is not in the IG table (`plan.md:199-204`). Fix: add IG-5 — "the requested effort/provider values handed to the comparator are already in the server's vocabulary; the mapping is owned by the #53 driver and is unproven here" — and state in D-2 that the comparator's caller, not the comparator, owns vocabulary translation.

**4. The success path of the pre-turn function is unspecified.**
D-6 (`plan.md:70-78`) and the whole ordering matrix (`plan.md:155-167`) specify `refused`, `unknown`, and zero-turn cases. Nothing states what the function returns when the route is `known` and `turn/start` is acknowledged — thread id, turn handle, `accepted`, or the route evidence itself. That is the value a #53 driver will map into `DispatchResult`, and leaving it undeclared invites the implementer to invent it and the reviewer to have no pin. Fix: declare the success return shape and add one positive test asserting it carries the verified thread id and the `known` route evidence.

**5. "Absence means unverified" is enforced only by prose.**
`plan.md:32` adds `DispatchResult.route?:` optional and `plan.md:34,118,231` make its meaning documentation plus a test. Every consumer reaching for it will write `result.route?.status === "mismatch"` and treat `undefined` as fine — the exact fail-open shape the seam elsewhere refuses to leave to prose (`packages/subagents/src/provider.ts:186-194` records this precise lesson about a guarantee that was "prose"). Fix: export a callable predicate (`isRouteVerified(result): boolean`) that returns `false` for absent, `unknown`, and `mismatch`, and add an invariant test that `verdict === "accepted"` with a present non-`known` route is refused/impossible. Cheap, and it converts the slice's central safety default from a sentence into a function.

## Required

**6. Test expectations are non-deterministic where they must be pinned.**
`plan.md:148` expects alias/case/relative-cwd/trailing-space fixtures to "mismatch **or** become unknown." A test spec that admits either outcome cannot fail. By D-2/D-3 each of those is a nonblank string, hence valid, hence `mismatch` — and `mismatch` maps to `refused`, which *is* retryable (`packages/subagents/src/provider.ts:258`), while `unknown` is not. The two branches have opposite operational consequences. Fix: pin the exact expected status per fixture.

**7. A real mismatch masked by one invalid field is reported as `unknown` with no record of the difference.**
Under D-3 (`plan.md:48-49`), provider-differs plus model-null yields `unknown`. That is correctly conservative for the send decision, but the reason renderer as specified (`plan.md:141-143`) only enumerates fields on the `mismatch` path, so the operator loses the one diagnostic that explains the incident. Fix: the reason must enumerate observed differences *and* invalid fields on the `unknown` path too, with a test.

**8. `refused` licenses retry, and a route mismatch is not fixed by retrying.**
`retryGuidance` prints "a retry is safe once the cause is fixed" (`packages/subagents/src/provider.ts:268`); for a route mismatch the cause is server-side configuration, so an automatic retry loop is deterministic and silent. The mapping itself is right — nothing useful was sent — but the reason string must say the cause is server configuration and that retrying without a config change will refuse identically. Fix: state this in the reason renderer spec and assert it.

**9. Source credibility: the id-echo claim rests on one unarchived page.**
`plan.md:68` calls `learn.chatgpt.com/docs/app-server#message-schema` the "official message schema" and derives the load-bearing "responses echo request ids" from it. `protocol-schema.md:36` honestly records that this URL was reached via the former `developers.openai.com` path, and the generated schema excerpt (`protocol-schema.md:13-26`) contains no id/correlation declaration — so nothing corroborates the correlation claim. Note that the failure mode is fail-safe (a non-echoing server produces a wrong/absent id → `unknown` → no send), and say so explicitly in D-5 rather than asserting documentary authority. Additionally, record a hash or retained excerpt of the doc as was done for the schema, so the claim is checkable later.

**10. Schema-vs-daemon version skew is not named as a gate.**
`protocol-schema.md:7` derives the field shape from the locally installed 0.153.4 build (and notes the generator emitted a permission-denied cleanup warning, though exit 0 and per-file hashes are recorded). The daemon #53 eventually attaches to may be a different version with different key names. IG-3 covers topology but not version skew. Fix: extend IG-3 to name version skew, and state the fail-safe (unrecognised keys → `unknown` → no send), which is correct behaviour and worth pinning as a test rather than an assumption.

**11. Route reasons will emit absolute host paths, and the source label is an open string.**
`plan.md:142` requires the reason to name both exact cwd values; absolute worktree paths carry usernames and project names into whatever logs consume the reason. Separately, the per-field "source label" (`plan.md:33`) is unconstrained, so a caller can put arbitrary text — including secrets — into an evidence field that is designed to be printed. Fix: make the source label a closed union; state in D-1 that `RouteIdentityEvidence` is closed to exactly these four fields and must never carry tokens, env values, or auth paths; note in the README/doc change that route reasons contain absolute paths.

## Advisory

**12. Record the superseded acceptance checkbox on the issue before closure.** OF-1 (`plan.md:105-108`) and D-001 (`drift.md:12`) correctly apply the later owner directive over the older opt-out checkbox at https://github.com/rickylabs/harness/issues/195 — that resolution matches the current steering and I do not contest it. But the public issue text still requests an opt-out, and this run may not touch the board (`supervisor.md:49`). Add to the handoff an explicit ask that the owner record the supersession on #195, so a future reader does not reopen it as an unmet acceptance criterion.

**13. Pin the exact doc wording, and sweep every stale "empty stub" claim.** The highest-likelihood risk in the register is "Helper is mistaken for deployed enforcement — High/High" (`plan.md:221`), and the mitigation is entirely prose in files the plan lists but does not draft (`plan.md:127-129`). Require that the changed docs state, in words, "no Codex provider is composed into `ctx.subagents`." Also ensure the sweep covers all three stale locations: `packages/provider-codex/src/index.ts:5-6` (whose "do not add behaviour here" comment the manifest contradicts), `packages/provider-codex/README.md:6`, and `docs/concepts/02-the-two-seams.md:118`.

## What I checked and did not fault

- **Unknown never permits**: `plan.md:49,75,160` plus `packages/subagents/src/provider.ts:258` — unknown yields no `turn/start`, no retry. Sound.
- **Post-send safety**: every failure after the send is `unknown`, never `refused` (`plan.md:75-76,166-167`), with a call-log assertion proving a useful send occurred. This is the correct reading of the retry contract and is the strongest part of the plan.
- **No live provider claim**: D-7 (`plan.md:80-86`), the acceptance map's "production provider enforcement | No" (`plan.md:25`), and the IG table (`plan.md:199-204`) keep the slice honest as a primitive. No spawn, attach, auth, or credential access is planned (`supervisor.md:50-53`); the schema capture is offline and credential-free (`protocol-schema.md:7`).
- **Scope**: the mutation manifest (`plan.md:114-129`) contains no routing table, `/swarm` grammar, dsh-app composition, board, or sibling-repo edit, consistent with D-8 and `supervisor.md`.

New gate code should not ship until findings 1–11 are folded into the locked plan; record them as drift entries rather than rewriting history, per `context-pack.md:64`.
