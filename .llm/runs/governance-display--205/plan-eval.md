# Plan gate

Independent Opus 5 medium (canonical straightforward plan-evaluation cell), separate from Sol medium author: PASS AFTER NARROW FIXES. Coordinator verified every required disposition against amended plan/research before product mutation. Gate: PASS with the narrow fixes complete. The full independent verdict follows. Source baseline9d800b54e447a600d8afab2ff90d07455b13a9c7. No fallback.

## Verdict: **PASS AFTER NARROW FIXES**

Scope reviewed: `.llm/runs/governance-display--205/plan.md` + `research.md`, display/synthetic-observation half only. I did not evaluate the live-adapter half, #62, or full #87/#205 acceptance. No mutation, no network, no subagents; reads confined to the run directory and `packages/{contracts,telemetry}` source.

### What holds up under attack

- **Typed reuse is real, not nominal.** `RegimeStatus` genuinely lacks a top-level timestamp (`packages/contracts/src/governance.ts:118-136`) and the refused `DispatchOutcome` member genuinely has no item field (`packages/contracts/src/routes.ts:105-113`), so D1's envelope adds exactly the two facts the contracts don't carry and nothing else. Embedding `state: GovernanceState` whole is structural reuse, not a copied vocabulary.
- **Complete/stale/unknown truth is consistent with the existing exit contract.** Absent flag → note, exit 0; explicitly-requested-but-unreadable → `complete: false`, exit 3. That mirrors `loadItems` exactly (`packages/telemetry/src/cli.ts:229-246`, `488`) and matches `EXIT_MEANINGS.incomplete` (`cli.ts:68`). Stale-but-valid staying exit 0 is correct: the store *was* read.
- **Refresh (F12) is structurally guaranteed**, since `status`/`tree` rebuild from disk per invocation (`cli.ts:406-428`, `485-512`).
- **Null headroom** is addressed by D5 + F4; `humanBytes` already exists for reuse (`observability.ts:205-210`).
- **Authority boundary is clean.** Mutation surface excludes `packages/governance/**`, no host channel is selected, and the stop condition + S7 wording prevent a display PASS from closing #87/#205.

### Narrow fixes required before S1

**N1 — Future-dated observations render as maximally fresh.** `humanAge` clamps to zero (`packages/telemetry/src/render.ts:~150`, `Math.max(0, ...)`), so `observedAt > now` prints "read under a minute ago", and D2 still classifies it fresh because `now <= validUntil`. D4 constrains only `validUntil >= observedAt`; nothing constrains either against `now`. Add an explicit ahead-of-now classification in D2 (not silently aged), and a fixture for it — the matrix currently has no future-dated case.

**N2 — Admission freshness is undefined relative to the envelope.** `AdmissionObservation` carries its own `observedAt`/`provenance` but no `validUntil` (plan D1; research.md:85-92), and D2's freshness rule is stated only over the envelope. A six-hour-old `pause` therefore renders beside fresh state with no `STALE` marker — precisely the "stale data appears current" risk the register claims F5 covers, which F5 does not. Pick one rule and state it: admissions inherit the envelope's validity **and** `admission.observedAt` must lie within `[envelope.observedAt - bound, envelope.observedAt]`; add a divergent-admission-timestamp fixture.

**N3 — D4 does not validate the whole `GovernanceState`.** The envelope is typed as the full contract value, which also requires `generatedAt`, `pending`, and `notes` (`governance.ts:204-209`). D4's bullet list covers only regimes/accounts/providers/hosts. As written, the implementer must either validate those three or default them — and defaulting `pending: []` publishes "no approval is waiting", a false statement of exactly the kind `governance.ts:16-26` exists to prevent. Enumerate validation for every `GovernanceState` member, or narrow the embedded type and assert assignability in the other direction.

**N4 — Leaf timestamps have no interval rule, and `observedAt: null` is untested.** `SubscriptionAccount`/`MeteredSpend`/`CapacityReading` each carry `observedAt: string | null` (`governance.ts:82, 92, 108`), plus `GovernanceState.generatedAt` — four more "when" values with no stated relation to the envelope's `observedAt`. D5 says "observation age" per regime without saying which timestamp it derives from, and F4 covers null *ceiling* and null *capacity components* but not a null leaf `observedAt` under `state: "allow"` — the contract's canonical unread-regime shape. Specify: age comes from the leaf's own `observedAt`, `null` renders "never read" (never healthy), leaf timestamps may not exceed the envelope's, and extend F4.

**N5 — Freshness must compare epoch milliseconds, not strings.** `--now` is stored as the raw string and only `Date.parse`-validated (`cli.ts:196-201`), and this repo already contains a lexicographic-timestamp precedent an implementer may copy (`snapshot.ts:138`). A `+02:00`-offset `--now` against a `Z` `validUntil` inverts under string compare. One line in D2.

**N6 — Publish list is unenumerated, and prose fields are bounded but not content-checked.** D6 says "project field by field" without listing the fields; whether `pending` is published is undecided. Separately, only `provenance` gets a safe grammar — `outcome.detail`, `reason`, regime `note`, `account`, `host`, `provider`, and `PendingApproval.summary` are free producer prose published verbatim, so D6's "never expose ... any read error containing a real home path" reads as a guarantee the design does not provide once a live producer exists. Enumerate the published governance fields, decide `pending`, and either extend the F10 canary to every free-text field or state in writing that prose content-safety is the producer's inherited contract obligation. Silence here is the weakest point in the privacy story.

**N7 — Fixture command feasibility.** `--home <temporary-empty-home>` does not isolate the run: `resolveObservability(flags.home, process.env)` (`cli.ts:415`) still honours `DSH_TELEMETRY_DIR`/`DSH_TELEMETRY_ARCHIVE`, so an ambient env var points the scan at real telemetry. Neutralize both in the gate commands. Also state that the gates run in listed order — `dist/cli.js` only exists after `pnpm --filter @rickylabs/telemetry test`, which runs `tsc -b` (`packages/telemetry/package.json:30`).

**N8 — State the contracts dependency as required, not conditional.** The mutation surface allows a dependency edit "only if the type import requires them". It does: telemetry has **no** `dependencies` block and **no** tsconfig `references` today, while `packages/dsh-app` shows the pattern. This is a new coupling for a package whose `model.ts` explicitly documents keeping the board join structural to avoid one. It's the right trade for ratified value types, but make it an explicit S1 step with that rationale rather than a footnote.

### Not blocking, noted

- F11's byte-identical claim covers sorted data arrays but not note ordering; `renderNotes` preserves Map insertion order (`render.ts:~186`), so loader-appended notes should be sorted or fixed too.
- D4's non-negativity rule permits `used > total`, yielding negative headroom. Add `used <= total`.
- `--observations` will be accepted-and-ignored by `runs`/`why`/`record` since `parseFlags` is global — same as `--items` today, so consistent; no change needed.

None of these require replanning. They are additions to D2, D4, D5, D6 and the gate commands, plus three or four fixture rows. Re-review of the amended sections is sufficient; a full replan is not.
