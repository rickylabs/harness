# Capability detection — resume context

OWNER-REQUESTED PAUSE UNTIL RESET. Read reset-checkpoint.md first.
Issue274 is research/planning only; no delivered plan, independent verdict or product code.
Preserved native planner session, identifier withheld; gracefully stopped at the
owner's request, not completed. Do not launch anything until the owner resumes.

Read supervisor.md, coordinator-discovery.md and matrix-plan.json as historical routing evidence.
Query the CLI fresh before any future dispatch; preserve the session rather than starting over.
The full configuration/detection scope and E11 DAG remain intact. Schema272's additional review
and recovery0.4 publication have separate unanswered owner decisions. Published0.3.0 remains
sufficient for the jointly selected first real-read flow through the backend-generated client.

---

## Current state — 2026-09-13, after the research session

**The pause above is lifted for research only.** `research.md` and `verification.md` now exist;
`plan.md` still does not, and that is the whole remaining debt of this step. A reader arriving cold
needs `research.md` and nothing else — it is written to be self-contained and every load-bearing
claim in it is either a measurement with its command in `verification.md` or a `path:line`
citation.

Baseline `aa06a6c` (origin/main). Fleet authority read at NetScript `155dbbe90`. Branch
`research/274-capability-detection`, one pull request, documentation only, `pnpm run build` exit 0.
The charter advanced: `ARCHITECTURE.md` is locked at v1 by decision 0003, and decision 0004
corrected §10's park evidence. Read the charter before this file.

**The one thing to carry forward if you read nothing else.** The resolver issue 274 needs already
exists in netscript — `resolveWorkloadRoute` at `routing-policy.ts:190` — and already accepts
detection results as `unavailableModels` / `unavailableTransports`. No CLI exposes it. The upstream
request is *expose the resolver* (request N-1 in `research.md` §R-5), not *export the capability
table*: exporting the table would move transport precedence, the deep-research restriction,
evaluator family opposition, privileged-tier authority and the `provider_default` coercion across
the repository boundary, which is the drift `ARCHITECTURE.md` §11 warns about.

**What the next session should do, in order.**

1. Do not re-measure. `verification.md` is the receipt; re-run a row only if you doubt it.
2. Read `research.md` §R-5. Seven numbered upstream requests against netscript, each with the
   reason and the file that already contains most of the answer. Three of them (N-2, N-4, N-5) are
   defects with a located root cause; N-1 is the one that unblocks `ARCHITECTURE.md` §11 step 2.
3. Read §R-7 before proposing anything. Four of issue 274's six items are substantially satisfied
   already, in three places: `packages/routing/src/probe.ts` owns the unknown-and-fail-closed
   discipline, `packages/routing/src/{schema,load,admit}.ts` own validated versioned JSON with
   byte-digest provenance and a scrubbed diagnostic surface, and `packages/telemetry/src/`
   `{cli,source}.ts` already ship the bounded credential-safe subprocess reader a detector needs to
   call rather than rebuild. What is genuinely missing is narrower than the issue's wording: the
   `installed`/`authenticated`/`entitled`/`quota` facts have no representation, configuration
   cannot express an account binding or a client-version constraint, there is no `capturedAt` on
   configuration provenance, and there is no machine-readable schema artifact for a generator.
4. Then write `plan.md`, with the six open questions in §"Unknowns" as numbered owner forks where
   they are owner questions, and as spikes where they are cheap facts. U-1 — whether
   `claude --effort` sets `CLAUDE_EFFORT` — is one paid launch and is the cheapest step toward
   invariant I1's effort leg.
5. `plan.md` must pass independent evaluation before any product mutation. That is issue 274's own
   execution rule and `doctrine/WORKFLOW.md` Stage G, not a preference.

**Still open elsewhere, unchanged by this session:** schema 272's additional review and the 0.4
recovery publication each have an unanswered owner decision. The preserved planner session
The preserved planner session was not resumed and was not stopped by this session.

**Standing constraints for this run.** No product code, no new package, no schema file, no copy of
the matrix or the capability table into this repository. No UHP work — E3 is parked per §10. No
proposal to extract the netscript runtime — not on the critical path per §11. Detection commands
must stay read-only and free. Never print or commit a credential, token, cookie or account
identifier; `claude auth status` returns three of them beside the three fields a receipt wants, so
a detector must emit an allowlist of fields, never a denylist.
