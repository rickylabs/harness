import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TTL,
  EMPTY_LEDGER,
  GRANT_OUTCOMES,
  LEASE_REFUSALS,
  LEASE_STATES,
  RESOLUTIONS,
  acquire,
  admitResume,
  checkLedger,
  describeGrant,
  describeLeaseProblem,
  describeLeaseState,
  describeResolution,
  holds,
  isAdvisory,
  leaseOf,
  leaseStatus,
  release,
  resolveSession,
  type Lease,
  type LeaseLedger,
  type LeaseRefusal,
  type TranscriptFile,
} from "./lease.js";

const NOW = "2026-09-06T12:00:00.000Z";

/** Minutes before {@link NOW}, as an ISO moment. */
function ago(minutes: number): string {
  return new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
}

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    runId: "run-alpha",
    holder: "coordinator-1",
    fence: 1,
    acquiredAt: ago(30),
    renewedAt: ago(2),
    ttl: "15m",
    ...overrides,
  };
}

function ledgerOf(leases: readonly Lease[], fence?: number): LeaseLedger {
  const highest = leases.reduce((top, row) => (row.fence > top ? row.fence : top), 0);
  return { leases, fence: fence ?? highest };
}

function transcript(overrides: Partial<TranscriptFile> = {}): TranscriptFile {
  return {
    path: "/home/agent/.claude/projects/harness/abc.jsonl",
    sessionId: "abc",
    modifiedAt: ago(5),
    bytes: 4096,
    tail: "…dispatched run-alpha, working on packages/subagents…",
    ...overrides,
  };
}

describe("leaseOf and leaseStatus", () => {
  it("reports an unheld run without inventing a lease", () => {
    const status = leaseStatus(EMPTY_LEDGER, "run-alpha", NOW);
    assert.equal(status.state, "unheld");
    assert.equal(status.lease, null);
    assert.equal(status.expiresAt, null);
    assert.equal(status.remainingMs, null);
  });

  it("holds a lease that is still inside its ttl", () => {
    const status = leaseStatus(ledgerOf([lease()]), "run-alpha", NOW);
    assert.equal(status.state, "held");
    assert.equal(status.expiresAt, ago(-13));
    assert.equal(status.remainingMs, 13 * 60_000);
  });

  it("expires a lease whose holder stopped renewing", () => {
    const status = leaseStatus(ledgerOf([lease({ renewedAt: ago(90) })]), "run-alpha", NOW);
    assert.equal(status.state, "expired");
    assert.ok(status.remainingMs !== null && status.remainingMs < 0);
  });

  it("takes the first of two rows for one run, rather than picking a winner", () => {
    const ledger = ledgerOf([lease({ holder: "first" }), lease({ holder: "second", fence: 2 })], 2);
    assert.equal(leaseOf(ledger, "run-alpha")?.holder, "first");
  });

  it("reads an unparseable clock as held, never as expired", () => {
    // A parse failure is not evidence that a lease lapsed. Treating it as one would hand the run
    // to a second writer on the strength of a bad string.
    const status = leaseStatus(ledgerOf([lease({ renewedAt: ago(600) })]), "run-alpha", "yesterday");
    assert.equal(status.state, "held");
    assert.equal(status.expiresAt, null);
  });

  it("reads an unparseable ttl as held with no expiry", () => {
    const status = leaseStatus(ledgerOf([lease({ ttl: "soon" })]), "run-alpha", NOW);
    assert.equal(status.state, "held");
    assert.equal(status.remainingMs, null);
  });
});

describe("acquire", () => {
  it("grants a free run at fence 1", () => {
    const grant = acquire(EMPTY_LEDGER, { runId: "run-alpha", holder: "coordinator-1" }, NOW);
    assert.equal(grant.outcome, "granted");
    assert.equal(grant.previous, null);
    assert.equal(grant.lease?.fence, 1);
    assert.equal(grant.lease?.ttl, DEFAULT_TTL);
    assert.equal(grant.lease?.acquiredAt, NOW);
    assert.equal(grant.ledger.fence, 1);
    assert.equal(grant.ledger.leases.length, 1);
  });

  it("renews without moving the fence", () => {
    const before = ledgerOf([lease()]);
    const grant = acquire(before, { runId: "run-alpha", holder: "coordinator-1" }, NOW);
    assert.equal(grant.outcome, "renewed");
    assert.equal(grant.lease?.fence, 1);
    assert.equal(grant.ledger.fence, 1);
    assert.equal(grant.lease?.renewedAt, NOW);
    // The acquisition moment is history and stays put.
    assert.equal(grant.lease?.acquiredAt, ago(30));
  });

  it("refuses a live lease held by somebody else and writes nothing", () => {
    const before = ledgerOf([lease()]);
    const grant = acquire(before, { runId: "run-alpha", holder: "coordinator-2" }, NOW);
    assert.equal(grant.outcome, "refused");
    assert.equal(grant.lease, null);
    assert.equal(grant.ledger, before);
    assert.match(grant.detail, /coordinator-1/);
  });

  it("takes over a lapsed lease and advances the fence past it", () => {
    const before = ledgerOf([lease({ renewedAt: ago(90) })]);
    const grant = acquire(before, { runId: "run-alpha", holder: "coordinator-2" }, NOW);
    assert.equal(grant.outcome, "taken-over");
    assert.equal(grant.lease?.fence, 2);
    assert.equal(grant.previous?.fence, 1);
    assert.equal(grant.ledger.leases.length, 1);
  });

  it("advances the fence even when the same holder reclaims its own lapsed lease", () => {
    // The old process may still be alive; it only stopped renewing. Reusing its fence would leave
    // its in-flight resume looking current.
    const before = ledgerOf([lease({ renewedAt: ago(90) })]);
    const grant = acquire(before, { runId: "run-alpha", holder: "coordinator-1" }, NOW);
    assert.equal(grant.outcome, "taken-over");
    assert.equal(grant.lease?.fence, 2);
    assert.match(grant.detail, /its own lapsed lease/);
  });

  it("counts the fence across the ledger, not per run", () => {
    const first = acquire(EMPTY_LEDGER, { runId: "run-alpha", holder: "c1" }, NOW);
    const second = acquire(first.ledger, { runId: "run-beta", holder: "c2" }, NOW);
    assert.equal(second.lease?.fence, 2);
    assert.equal(second.ledger.leases.length, 2);
  });

  it("takes an explicit ttl", () => {
    const grant = acquire(EMPTY_LEDGER, { runId: "run-alpha", holder: "c1", ttl: "2h" }, NOW);
    assert.equal(grant.lease?.ttl, "2h");
    assert.equal(leaseStatus(grant.ledger, "run-alpha", NOW).remainingMs, 2 * 60 * 60_000);
  });

  it("treats an empty ttl as absent", () => {
    const grant = acquire(EMPTY_LEDGER, { runId: "run-alpha", holder: "c1", ttl: "" }, NOW);
    assert.equal(grant.lease?.ttl, DEFAULT_TTL);
  });

  it("drops every duplicate row for the run it writes", () => {
    const before = ledgerOf([lease({ holder: "c1" }), lease({ holder: "c1", fence: 1 })], 1);
    const grant = acquire(before, { runId: "run-alpha", holder: "c1" }, NOW);
    assert.equal(grant.ledger.leases.length, 1);
    assert.equal(checkLedger(grant.ledger, NOW).length, 0);
  });
});

describe("release", () => {
  it("removes the row and leaves the fence where it is", () => {
    const before = ledgerOf([lease()]);
    const result = release(before, "run-alpha", "coordinator-1");
    assert.equal(result.released, true);
    assert.equal(result.ledger.leases.length, 0);
    // A released token is not returned to the pool: the next grant must not reuse its number.
    assert.equal(result.ledger.fence, 1);
  });

  it("refuses to release somebody else's lease", () => {
    const before = ledgerOf([lease()]);
    const result = release(before, "run-alpha", "coordinator-2");
    assert.equal(result.released, false);
    assert.equal(result.ledger, before);
  });

  it("says so when there was nothing to release", () => {
    const result = release(EMPTY_LEDGER, "run-alpha", "coordinator-1");
    assert.equal(result.released, false);
    assert.equal(result.previous, null);
  });
});

describe("holds", () => {
  it("accepts the holder at the fence on record", () => {
    assert.equal(holds(ledgerOf([lease()]), "run-alpha", "coordinator-1", 1), true);
  });

  it("rejects the right holder at a superseded fence", () => {
    const taken = acquire(
      ledgerOf([lease({ renewedAt: ago(90) })]),
      { runId: "run-alpha", holder: "coordinator-1" },
      NOW,
    );
    assert.equal(holds(taken.ledger, "run-alpha", "coordinator-1", 1), false);
    assert.equal(holds(taken.ledger, "run-alpha", "coordinator-1", 2), true);
  });

  it("rejects an unheld run", () => {
    assert.equal(holds(EMPTY_LEDGER, "run-alpha", "coordinator-1", 1), false);
  });
});

describe("resolveSession", () => {
  it("reports absence when nothing was observed", () => {
    const outcome = resolveSession({ runId: "run-alpha", candidates: [] });
    assert.equal(outcome.outcome, "absent");
    assert.equal(outcome.session, null);
  });

  it("searches for the run id when no marker is given", () => {
    const outcome = resolveSession({ runId: "run-alpha", candidates: [transcript()] });
    assert.equal(outcome.marker, "run-alpha");
    assert.equal(outcome.outcome, "resolved");
    assert.equal(outcome.session?.sessionId, "abc");
  });

  it("reports unmatched when no tail carries the marker", () => {
    const outcome = resolveSession({
      runId: "run-beta",
      candidates: [transcript(), transcript({ path: "/b.jsonl", sessionId: "b" })],
    });
    assert.equal(outcome.outcome, "unmatched");
    assert.equal(outcome.matched, 0);
    assert.equal(outcome.considered, 2);
  });

  it("takes the newest of several matches", () => {
    const outcome = resolveSession({
      runId: "run-alpha",
      candidates: [
        transcript({ path: "/old.jsonl", sessionId: "old", modifiedAt: ago(300) }),
        transcript({ path: "/new.jsonl", sessionId: "new", modifiedAt: ago(1) }),
        transcript({ path: "/mid.jsonl", sessionId: "mid", modifiedAt: ago(60) }),
      ],
    });
    assert.equal(outcome.outcome, "resolved");
    assert.equal(outcome.session?.sessionId, "new");
    assert.equal(outcome.runnerUp?.sessionId, "mid");
    assert.equal(outcome.matched, 3);
  });

  it("refuses to break a tie on modification time", () => {
    // Two equal claims. Picking one would be a coin toss wearing a rule's clothes.
    const outcome = resolveSession({
      runId: "run-alpha",
      candidates: [
        transcript({ path: "/a.jsonl", sessionId: "a", modifiedAt: ago(5) }),
        transcript({ path: "/b.jsonl", sessionId: "b", modifiedAt: ago(5) }),
      ],
    });
    assert.equal(outcome.outcome, "ambiguous");
    assert.equal(outcome.session, null);
    assert.equal(outcome.runnerUp?.sessionId, "b");
  });

  it("honours an explicit marker over the run id", () => {
    const outcome = resolveSession({
      runId: "run-alpha",
      marker: "task-77",
      candidates: [transcript(), transcript({ path: "/b.jsonl", sessionId: "b", tail: "task-77 here" })],
    });
    assert.equal(outcome.marker, "task-77");
    assert.equal(outcome.session?.sessionId, "b");
  });

  it("ranks an unreadable modification time oldest instead of sorting unpredictably", () => {
    const outcome = resolveSession({
      runId: "run-alpha",
      candidates: [
        transcript({ path: "/broken.jsonl", sessionId: "broken", modifiedAt: "whenever" }),
        transcript({ path: "/good.jsonl", sessionId: "good", modifiedAt: ago(600) }),
      ],
    });
    assert.equal(outcome.outcome, "resolved");
    assert.equal(outcome.session?.sessionId, "good");
  });

  it("does not treat two unreadable timestamps as a match", () => {
    // `-Infinity - -Infinity` is NaN, and a NaN comparator makes sort order undefined. Both rank
    // equal, so this is ambiguous — deterministically.
    const outcome = resolveSession({
      runId: "run-alpha",
      candidates: [
        transcript({ path: "/x.jsonl", sessionId: "x", modifiedAt: "whenever" }),
        transcript({ path: "/y.jsonl", sessionId: "y", modifiedAt: "later" }),
      ],
    });
    assert.equal(outcome.outcome, "ambiguous");
  });

  it("matches nothing when the marker is empty", () => {
    const outcome = resolveSession({ runId: "", candidates: [transcript()] });
    assert.equal(outcome.outcome, "unmatched");
    assert.match(outcome.detail, /an empty marker/);
  });
});

describe("admitResume", () => {
  const held = ledgerOf([lease()]);
  const attempt = {
    runId: "run-alpha",
    holder: "coordinator-1",
    fence: 1,
    candidates: [transcript()],
  };

  it("admits the holder at the right fence with one resolved transcript", () => {
    const decision = admitResume(held, attempt, NOW);
    assert.equal(decision.admitted, true);
    assert.deepEqual(decision.reasons, []);
    assert.equal(decision.session?.sessionId, "abc");
    assert.equal(decision.state, "held");
    assert.equal(decision.fence, 1);
  });

  it("refuses a resume with no lease behind it", () => {
    const decision = admitResume(EMPTY_LEDGER, attempt, NOW);
    assert.equal(decision.admitted, false);
    assert.equal(decision.session, null);
    assert.ok(reasons(decision.reasons).includes("no-lease"));
  });

  it("refuses the second writer — the 4090 case, caught before the process starts", () => {
    const decision = admitResume(held, { ...attempt, holder: "coordinator-2" }, NOW);
    assert.equal(decision.admitted, false);
    assert.ok(reasons(decision.reasons).includes("held-by-another"));
  });

  it("refuses a holder whose lease lapsed while it was away", () => {
    const stale = ledgerOf([lease({ renewedAt: ago(90) })]);
    const decision = admitResume(stale, attempt, NOW);
    assert.equal(decision.admitted, false);
    assert.equal(decision.state, "expired");
    assert.ok(reasons(decision.reasons).includes("lease-expired"));
  });

  it("refuses a stale fence even when the holder name still matches", () => {
    const decision = admitResume(held, { ...attempt, fence: 0 }, NOW);
    assert.equal(decision.admitted, false);
    assert.ok(reasons(decision.reasons).includes("stale-fence"));
  });

  it("refuses when the run id is one of the vendor's own session ids", () => {
    // Criterion 2, made checkable without guessing at id formats.
    const decision = admitResume(
      ledgerOf([lease({ runId: "abc" })]),
      { ...attempt, runId: "abc" },
      NOW,
    );
    assert.equal(decision.admitted, false);
    assert.ok(reasons(decision.reasons).includes("keyed-on-vendor-id"));
  });

  it("refuses when nothing was observed to resume into", () => {
    const decision = admitResume(held, { ...attempt, candidates: [] }, NOW);
    assert.ok(reasons(decision.reasons).includes("session-absent"));
  });

  it("refuses when two transcripts have an equal claim", () => {
    const decision = admitResume(
      held,
      {
        ...attempt,
        candidates: [
          transcript({ path: "/a.jsonl", sessionId: "a" }),
          transcript({ path: "/b.jsonl", sessionId: "b" }),
        ],
      },
      NOW,
    );
    assert.equal(decision.admitted, false);
    assert.ok(reasons(decision.reasons).includes("session-ambiguous"));
  });

  it("does not decide anything on an unreadable clock", () => {
    const decision = admitResume(held, attempt, "the other day");
    assert.equal(decision.admitted, false);
    assert.ok(reasons(decision.reasons).includes("clock-unreadable"));
  });

  it("admits a stale transcript but says so", () => {
    const decision = admitResume(
      held,
      { ...attempt, candidates: [transcript({ modifiedAt: ago(30 * 60) })] },
      NOW,
    );
    assert.equal(decision.admitted, true);
    assert.ok(reasons(decision.reasons).includes("transcript-stale"));
  });

  it("takes an explicit staleness window", () => {
    const decision = admitResume(
      held,
      { ...attempt, candidates: [transcript({ modifiedAt: ago(10) })], stale: "5m" },
      NOW,
    );
    assert.equal(decision.admitted, true);
    assert.ok(reasons(decision.reasons).includes("transcript-stale"));
  });

  it("admits despite an unreadable modification time, and names the file", () => {
    const decision = admitResume(
      held,
      {
        ...attempt,
        candidates: [
          transcript({ path: "/broken.jsonl", sessionId: "broken", modifiedAt: "whenever" }),
          transcript({ path: "/good.jsonl", sessionId: "good", modifiedAt: ago(3) }),
        ],
      },
      NOW,
    );
    assert.equal(decision.admitted, true);
    assert.equal(decision.session?.sessionId, "good");
    const problem = decision.reasons.find((r) => r.reason === "mtime-unreadable");
    assert.ok(problem !== undefined);
    assert.match(problem.message, /broken\.jsonl/);
  });

  it("collects every reason rather than returning the first", () => {
    // A caller told one thing at a time learns the truth over several round trips, and in between
    // an operator starts guessing.
    const decision = admitResume(
      ledgerOf([lease({ renewedAt: ago(90) })]),
      { runId: "run-alpha", holder: "coordinator-2", fence: 9, candidates: [] },
      NOW,
    );
    const found = reasons(decision.reasons);
    assert.ok(found.includes("held-by-another"));
    assert.ok(found.includes("lease-expired"));
    assert.ok(found.includes("stale-fence"));
    assert.ok(found.includes("session-absent"));
  });

  it("keys every reason on the run it is about", () => {
    const decision = admitResume(EMPTY_LEDGER, attempt, NOW);
    for (const problem of decision.reasons) {
      assert.equal(problem.runId, "run-alpha");
      assert.match(describeLeaseProblem(problem), /^run-alpha: /);
    }
  });
});

describe("checkLedger", () => {
  it("passes a well-formed ledger", () => {
    assert.deepEqual(checkLedger(ledgerOf([lease()]), NOW), []);
  });

  it("reports a duplicate row rather than picking a winner silently", () => {
    const ledger = ledgerOf([lease({ holder: "a" }), lease({ holder: "b" })], 1);
    assert.ok(reasons(checkLedger(ledger, NOW)).includes("duplicate-lease"));
  });

  it("reports a fence above the ledger's own", () => {
    const ledger: LeaseLedger = { leases: [lease({ fence: 7 })], fence: 3 };
    assert.ok(reasons(checkLedger(ledger, NOW)).includes("fence-regressed"));
  });

  it("reports a ttl Go would reject", () => {
    assert.ok(reasons(checkLedger(ledgerOf([lease({ ttl: "15 minutes" })]), NOW)).includes("ttl-not-a-duration"));
  });

  it("accepts a bare zero ttl, because Go does", () => {
    assert.deepEqual(reasons(checkLedger(ledgerOf([lease({ ttl: "0" })]), NOW)), []);
  });

  it("reports a lease that names no holder", () => {
    assert.ok(reasons(checkLedger(ledgerOf([lease({ holder: "" })]), NOW)).includes("no-holder"));
  });

  it("reports a lease with no run id, keyed on nothing", () => {
    const problems = checkLedger(ledgerOf([lease({ runId: "" })]), NOW);
    assert.ok(reasons(problems).includes("no-run-id"));
    const first = problems[0];
    if (first === undefined) throw new Error("expected a problem");
    assert.equal(first.runId, null);
    // A whole-ledger problem is not prefixed with a run it cannot name.
    assert.equal(describeLeaseProblem(first), first.message);
  });

  it("reports an unreadable clock once, for the whole ledger", () => {
    const problems = checkLedger(ledgerOf([lease()]), "soon");
    assert.equal(problems.filter((p) => p.reason === "clock-unreadable").length, 1);
    assert.equal(problems[0]?.runId, null);
  });
});

describe("two coordinators, one session", () => {
  // Criterion 4. The scenario that produced "Remote Control disconnected — another connection took
  // over this session (code 4090)": two `claude --resume <same-id>` processes, live at once.

  it("computes the same fence for both, which is why the store must compare-and-set", () => {
    const snapshot = EMPTY_LEDGER;
    const first = acquire(snapshot, { runId: "run-alpha", holder: "coordinator-1" }, NOW);
    const second = acquire(snapshot, { runId: "run-alpha", holder: "coordinator-2" }, NOW);

    // Both read the same ledger, so both mint fence 1. Nothing in this module can prevent that —
    // the mutual exclusion is the store's write, guarded on `ledger.fence`.
    assert.equal(first.outcome, "granted");
    assert.equal(second.outcome, "granted");
    assert.equal(first.lease?.fence, 1);
    assert.equal(second.lease?.fence, 1);
  });

  it("refuses the loser's resume once one of the two ledgers has landed", () => {
    const winner = acquire(EMPTY_LEDGER, { runId: "run-alpha", holder: "coordinator-1" }, NOW);
    const persisted = winner.ledger;

    const loser = admitResume(
      persisted,
      { runId: "run-alpha", holder: "coordinator-2", fence: 1, candidates: [transcript()] },
      NOW,
    );

    assert.equal(loser.admitted, false);
    assert.equal(loser.session, null);
    assert.ok(reasons(loser.reasons).includes("held-by-another"));
    assert.equal(holds(persisted, "run-alpha", "coordinator-2", 1), false);

    // And the winner proceeds, on the same ledger, at the same moment.
    const won = admitResume(
      persisted,
      { runId: "run-alpha", holder: "coordinator-1", fence: 1, candidates: [transcript()] },
      NOW,
    );
    assert.equal(won.admitted, true);
  });

  it("refuses an evicted holder that wakes up and resumes anyway", () => {
    // Expiry alone protects nothing: the old process stopped renewing, not running. The fence is
    // what makes its token recognisably old.
    const lapsed = ledgerOf([lease({ holder: "coordinator-1", renewedAt: ago(90) })]);
    const takeover = acquire(lapsed, { runId: "run-alpha", holder: "coordinator-2" }, NOW);

    const zombie = admitResume(
      takeover.ledger,
      { runId: "run-alpha", holder: "coordinator-1", fence: 1, candidates: [transcript()] },
      NOW,
    );

    assert.equal(zombie.admitted, false);
    const found = reasons(zombie.reasons);
    assert.ok(found.includes("held-by-another"));
    assert.ok(found.includes("stale-fence"));
  });

  it("does not let a released lease hand the next holder an old token", () => {
    const first = acquire(EMPTY_LEDGER, { runId: "run-alpha", holder: "coordinator-1" }, NOW);
    const given = release(first.ledger, "run-alpha", "coordinator-1");
    const second = acquire(given.ledger, { runId: "run-alpha", holder: "coordinator-2" }, NOW);

    assert.equal(second.lease?.fence, 2);
    assert.equal(holds(second.ledger, "run-alpha", "coordinator-1", 1), false);
  });
});

describe("vocabulary", () => {
  it("describes every lease state", () => {
    for (const state of LEASE_STATES) assert.ok(describeLeaseState(state).length > 0);
  });

  it("describes every grant outcome", () => {
    for (const outcome of GRANT_OUTCOMES) assert.ok(describeGrant(outcome).length > 0);
  });

  it("describes every resolution", () => {
    for (const outcome of RESOLUTIONS) assert.ok(describeResolution(outcome).length > 0);
  });

  it("names exactly two advisory refusals; everything else blocks", () => {
    const advisory = LEASE_REFUSALS.filter((reason) => isAdvisory(reason));
    assert.deepEqual([...advisory], ["mtime-unreadable", "transcript-stale"]);
  });

  it("keeps the refusal vocabulary free of duplicates", () => {
    assert.equal(new Set(LEASE_REFUSALS).size, LEASE_REFUSALS.length);
  });
});

function reasons(problems: readonly { readonly reason: LeaseRefusal }[]): LeaseRefusal[] {
  return problems.map((problem) => problem.reason);
}
