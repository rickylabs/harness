# Context pack — `uhp-stream-adapter--s11`

The one file that resumes this run cold. Written for a reader with no history.

---

## In one paragraph

Spike **S11**, issue [#289](https://github.com/rickylabs/harness/issues/289): the **buildable half** of
UHP support. It adds SSE consumption, multi-turn continuation and the #287 lifecycle mapping to
`packages/subagents`, proven against the mock spike S10 shipped. It does **not** implement
`provider-uhp` (#286), does not touch `packages/contracts`, does not start a container, and proves
nothing whatsoever about a live HarnessRouter — that is [#294](https://github.com/rickylabs/harness/issues/294),
blocked on infrastructure. Issue #53 retires only on a PASS at #294.

## Where the work is

    packages/subagents/src/uhp-wire.ts        the protocol transcribed: types, event vocabularies
    packages/subagents/src/uhp-stream.ts      the SSE reader, and freshness from timestamps only
    packages/subagents/src/uhp-lifecycle.ts   UHP status -> RunLiveness, per #287
    packages/subagents/src/uhp-gate.ts        does the reported route permit a useful turn
    packages/subagents/src/uhp-session.ts     continuation on previous_response_id, keyed on runId
    packages/subagents/src/uhp-mock.ts        S10's mock, extended: frames, fixtures, session server
    packages/subagents/src/uhp-*.test.ts      92 tests, all mutation-tested
    packages/subagents/README.md              "Consuming UHP"
    .llm/runs/uhp-stream-adapter--s11/         this run

## The branch, which is stacked

Branched from **`origin/chore/route-identity-uhp--s10`** at `a382171`, not from `main`. S10 carries the
mock and is unmerged because it awaits an independent non-Claude evaluator. The pull request is based on
`chore/route-identity-uhp--s10`; when S10 merges, GitHub retargets it to `main`.

## The five things it does, and the argument for each

1. **SSE consumption.** `createUhpStreamReader(clock)` → `push`/`state`/`end`. Three states only: open
   with partial text, done with a terminal response, or refused. A refusal exposes no response, no text
   and no freshness — the type has no field to reach them through, because "the task finished" and "the
   stream stopped" must not share a representation.
2. **The status is authoritative, never the event name.** There is no `response.cancelled` event; a
   cancellation is `response.failed` carrying `status: "cancelled"`, and the chapter says so outright.
   An adapter reading the event name reports every cancelled run as failed.
3. **Freshness cannot be derived from a lifecycle status (#289 requirement A).** `uhpFreshness` takes
   evidence, a clock reading and windows. No status parameter exists. Evidence carries a module-private
   `Symbol` brand minted only from a delta or an output-item frame, and a forged object is dropped at
   runtime. `stalled` is excluded in the type: it needs a running *claim*, which is
   `@rickylabs/telemetry`'s join (#206).
4. **A substitution is read from `mismatches`, and a contradiction outranks a silence (requirements B
   and C).** Over UHP `status` is pinned to `unknown`, so a gate keyed on `status === "mismatch"` never
   fires and looks correct doing it; and the codex ladder's unknown-before-mismatch order makes the
   refusal branch unreachable. `uhpRouteVerdict` is handed only the negatives — its parameter type has
   no status field — and the status rides along in the diagnostic to explain.
5. **Runs are keyed on `runId`; the session id lives in `RunRef.external`.** The protocol may branch two
   chains out of one session, so one `session_id` can cover two runs and a ledger keyed on it would have
   one become the other. A continued chain reporting a *different* session id is refused: the spec
   requires the same one, and a different one is a different working directory.

## If you are picking this up

- Read `verification.md` first. §1 is what the mock proved, §2 is what is **unproven**, §3 is the
  fourteen-mutation table including the one that survived and what that taught.
- Read `drift.md` D-2 before judging the edits to S10's mock: the wire types moved, `decodeUhpStream`
  became a delegate, and S10's terminal-event list contained an event UHP does not define.
- `worklog.md` carries owner fork **F1**, unresolved on purpose: if S10's reading holds, no UHP route can
  ever be `accepted`, which makes `provider-uhp` a provider that correctly refuses everything. Three
  options, none taken. It belongs to #286 and #294.
- Do not delete the readers for `provider`, `effort` and `cwd`. They return `null` and a test asserts it.
  S10's finding is an unevaluated generator verdict; a reader that returns null costs nothing, and
  re-adding one after somebody concluded the field was dead costs a spike.

## Gates

`pnpm run build` green. `pnpm run test` green — 3,026 tests across 12 packages. The final
`check:installed` step needs an executable `TMPDIR` on this host and is unrelated to this run
(`verification.md` §0, `drift.md` D-5). Use pnpm, never npm.

## What must not be claimed

That any of this works against a HarnessRouter. Every byte came from a mock written from the
specification, on a host with no container runtime. If you are asked whether the round-trip works, the
answer is that it is untested and the issue is #294.
