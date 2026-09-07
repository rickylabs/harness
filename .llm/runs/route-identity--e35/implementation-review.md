# Independent implementation review — PR238 / issue195, route-identity--e35

## Verdict: **PASS**

**Reviewed SHA: `febfef79f62114323c2f81dd830e7325b77ce7d2`** — taken on **coordinator attestation** (coordinator ran `git rev-parse`, confirmed clean worktree). I ran no shell/git; this is **not** my own git inspection. All file references below are to that attested tree.

## Summary

The four-field gate, optional typed `DispatchResult.route`, fail-closed `isRouteVerified`, and the Codex pre-turn orchestrator are implemented exactly per the locked plan plus the 13 binding amendments. Every negative path lands `unknown` with zero `turn/start` sends; every post-send failure stays `unknown`; correlation is helper-owned and independently checked; no raw payload ever reaches evidence or diagnostics. Provider-codex ships protocol-only; nothing composes or claims deployment. Three non-blocking findings below (1 Low, 2 Info).

## Acceptance verification (evidence)

1. **Optional typed evidence; absence = unverified** — `packages/subagents/src/provider.ts:104-110`; documented "Absence is unverified, never agreement" (`provider.ts:107-109`); legacy compile/pass pinned `provider.test.ts:110-115`, `provider.test.ts:43-76`.
2. **Mixed unknown/mismatch diagnostic** — unknown precedence with differences retained: `route.ts:159-163`, `route.ts:134`; tests `route.test.ts:83-94`, `protocol.test.ts:205-217` (provider mismatch + null effort → unknown, zero turns, both facts in detail).
3. **Closed source union** — `route.ts:14-22`; asserted `route.test.ts:30-33`.
4. **Frozen requested values across awaits** — `protocol.ts:85-99` (freeze before first await at `protocol.ts:193`); mutation fixture `protocol.test.ts:227-251`.
5. **Independent response correlation** — helper-minted `randomUUID()` per call (`protocol.ts:204,250`), independent id comparison (`protocol.ts:130,156`); concurrent cross-delivery → both unknown, zero turns (`protocol.test.ts:253-275`); wrong-id fixtures (`protocol.test.ts:161,306`). Port is not trusted to certify correlation (`protocol.ts:19-25`).
6. **Nonblank thread+turn identities** — `protocol.ts:144,159`; missing thread id → unknown before turn (`protocol.ts:229-232`, test `protocol.test.ts:277-284`); missing/blank/wrong-type turn id → unknown after send (`protocol.ts:263-265`, tests `protocol.test.ts:309-310`).
7. **No raw error leaks** — invalid values nulled (`route.ts:32,82`); error responses reduced to a flag (`protocol.ts:133-135`); fixed-string details; leak assertions `protocol.test.ts:192,292,302,320`; throwing Proxy getters caught (`protocol.test.ts:286-303`).
8. **Strict vocabulary, absolute cwd, no normalization** — exact equality (`route.ts:139-166`); case/alias/trailing-space/equivalent-cwd fixtures all mismatch (`route.test.ts:96-106`); relative requested cwd invalid, never known (`route.ts:84-86`, `route.test.ts:108-115`, `protocol.test.ts:219-225` zero sends); documented `provider-codex/README.md:24-26`.
9. **No turns on mismatch/unknown; post-send always unknown** — turn sent only after known (`protocol.ts:250-253` behind checks at 223-248); all six post-send outcomes (wrong id, error, malformed, empty id, wrong-type id, port rejection) → unknown, one send proven, non-retryable (`protocol.test.ts:305-322`); refusal only pre-send (`protocol.ts:238-247`), `isSafeToRetry` true only there.
10. **isRouteVerified fail-closed** — `provider.ts:273-276` + re-checking `route.ts:174-192` (sources, nonblank, absolute cwd, equality, try/catch); false for absent/unknown/mismatch/fabricated-contradictory (`route.test.ts:50,78,117-160`; `provider.test.ts:109-138`); used as final return gate (`protocol.ts:276-278`).
11. **Effort at thread/start; no turn override** — `protocol.ts:112`, `protocol.ts:117-126`; override-key absence asserted `protocol.test.ts:106-108`; daemon-default effort refused pre-turn `protocol.test.ts:196-203`.
12. **Success per amendment 4** — accepted only after correlated ack with nonblank turn id; mandatory known evidence; registrationId ≠ modelProvider (`protocol.test.ts:74-109`).
13. **Version skew / echo** — renamed-key fixture unknown (`protocol.test.ts:163-172`); echo-without-response-keys unknown (`protocol.test.ts:173-184`); keys match generated schema (`protocol-schema.md:13-26`).
14. **Honest boundary** — no `SubagentProvider` in provider-codex (`provider-codex/src/index.ts:13-23`); dsh-app greps show no import/composition of `startVerifiedCodexTurn`; README/packages-README/two-seams/package-index all distinguish prerequisite from provider (`provider-codex/README.md:5-9`, `packages/README.md:17`, `docs/concepts/02-the-two-seams.md:129-134`); worklog states no implementation PASS was self-claimed (`worklog.md:58`). No process/socket/auth/env/daemon code in the diff set; `dispatch.ts` grammar untouched (D-8).
15. **Callable orchestrator, not unused comparator** — `startVerifiedCodexTurn` exported and exercised across 20+ synthetic-port tests; no live canary required per brief.

## Findings (all non-blocking)

1. **[Low, doc, follow-up]** `README.md:151` still lists `provider-codex` as "Stub … each README opens with `Status: stub`" — now false (`provider-codex/README.md:5`). Root README is outside the locked mutation manifest, so fixing it inside this slice would be drift; correct it in the next authorized doc-only change. Understates rather than overclaims, so no deployment-misrepresentation risk.
2. **[Info]** Amendment 13's verbatim sentence "No Codex provider is composed into `ctx.subagents`" appears in 2 of 4 required locations (`provider-codex/README.md:8-9`, `docs/concepts/02-the-two-seams.md:132`); `packages/README.md:17` ("no composed provider (#195/#53)") and `provider-codex/src/index.ts:2-5` carry equivalent but not verbatim wording. Substance satisfied; record the equivalence in `drift.md` or add the verbatim sentence opportunistically.
3. **[Info, diagnostic precision]** Early-unknown paths (`protocol.ts:201,210,221`) attach evidence rendered from `UNOBSERVED_ROUTE` (`protocol.ts:68-73`), so detail contains "invalid observed … (thread/start.result.*)" entries for an observation that never happened (e.g., invalid request rejected before any send, or port rejection). The leading fixed clause states the true cause and nothing can become `known` from it — fail-closed is intact; consider distinguishing "never observed" from "observed invalid" in a later slice.

## Validation evidence read

`worklog.md:50-58` (Stage H receipts: subagents 227/227, provider-codex 44/44, `pnpm typecheck` 15 packages, full `pnpm build`) — coordinator/implementer receipts, not re-executed by me. All three test files and both source packages read in full; `plan.md`, `plan-amendment.md`, `plan-eval.md`, `context-pack.md`, `drift.md`, `protocol-schema.md` read in full.

## Limits

No shell, git, network, or test execution (read-only mandate): HEAD, clean worktree, and receipt numbers are coordinator attestation, not my measurements. No baseline diff against `99a32a7` was possible; scope conformance to the manifest was assessed by reading the declared paths plus targeted greps (dsh-app composition, dispatch grammar, repo-wide `startVerifiedCodexTurn`/lockfile). Unverified by me: the generated-schema transcription (`protocol-schema.md` is accepted as the offline evidence of record, hashes cited therein) and anything outside the reviewed file set beyond those greps. Per brief, absence was never treated as PASS — every claim above is tied to read evidence; IG-1/IG-2/IG-3/IG-4 remain open on #53 and are not certified here. Any follow-up review must be against the newest explicitly supplied SHA.
