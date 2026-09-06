/**
 * Single-writer session ownership.
 *
 * Owned by E3 · #33, defined by #56. `provider.ts` says of itself that it does not hold a lease and
 * that `RunRef` carries the run id this module keys on. This is the other half.
 *
 * ## The bug this exists for
 *
 * Two `claude --resume <same-id>` processes have run concurrently and produced *"Remote Control
 * disconnected — another connection took over this session (code 4090)"*. Nothing was corrupted
 * loudly. One of the two agents simply stopped being heard from, and its work carried on into a
 * transcript nobody was reading.
 *
 * ## Three rules, in the order they matter
 *
 * **A run is keyed on our id, never the vendor's.** `claude --resume` is version-dependent: it has
 * both appended to an existing transcript and minted a fresh session id for the same logical run.
 * An identifier that changes underneath you is not a key. `runId` is ours and exists before the run
 * does; `keyed-on-vendor-id` refuses the case where a vendor session id has quietly been passed in
 * its place, because that is the shape the bug takes before it becomes two live processes.
 *
 * **The vendor session is resolved, not remembered.** Since the id can change, the way back to a
 * transcript is to look for it: the newest modification time among the files whose tail carries our
 * marker. A tie on modification time is not a tiebreak — it is two files with an equal claim, and
 * choosing one is a coin toss wearing a rule's clothes. That is `session-ambiguous`.
 *
 * **The lease carries a fence.** A holder whose lease expired can still be alive; it only stopped
 * renewing. If it then wakes and resumes, expiry alone has protected nothing. So every grant that
 * changes hands takes a fence one higher than any issued before it, and a resume must present the
 * fence the ledger currently holds. The woken holder presents an older one and is refused.
 *
 * ## Where the atomicity actually lives
 *
 * Not here. Every function in this file is pure: it reads a ledger and returns the ledger that
 * should replace it. Two callers reading the same ledger both compute a grant, and both compute the
 * *same* fence — so the store has to apply the replacement under a compare-and-set on
 * {@link LeaseLedger.fence}, and {@link holds} is the check it performs before acting on a lease it
 * read earlier. This is said plainly because the alternative is a module that looks like it
 * provides mutual exclusion and does not.
 */

import { parseGoDuration } from "./dispatch.js";

/** How long a grant is good for when the caller does not say. */
export const DEFAULT_TTL = "15m";

/** How long a transcript may sit unmodified before resolving onto it is worth a second look. */
export const DEFAULT_STALE = "24h";

/**
 * A vendor transcript on disk, as the coordinator observed it.
 *
 * `tail` is however much of the end of the file the observer chose to read. It is a string rather
 * than a parsed structure because the four harnesses do not agree on a transcript format and this
 * module only ever asks one question of it: does our marker appear.
 */
export interface TranscriptFile {
  readonly path: string;
  /** The vendor's own id for the session. Used to name the file, never to key the run. */
  readonly sessionId: string;
  /** ISO 8601. */
  readonly modifiedAt: string;
  readonly bytes: number;
  readonly tail: string;
}

/**
 * One run's claim on its session.
 *
 * `renewedAt` and not just `acquiredAt` because the ttl runs from the last heartbeat: a holder that
 * is working and saying so should not lose its lease at a fixed wall time it never agreed to.
 */
export interface Lease {
  readonly runId: string;
  /** Whoever holds it — a coordinator instance, a worker, a tmux session. Opaque and compared whole. */
  readonly holder: string;
  /** Monotonic within a ledger. Bumped on every change of hands, never on a renewal. */
  readonly fence: number;
  readonly acquiredAt: string;
  readonly renewedAt: string;
  /** A Go duration, as everything else in this package spells one. */
  readonly ttl: string;
}

/**
 * The durable record.
 *
 * `fence` is the highest ever issued, not the count of live leases: it never decreases, and a
 * release does not give a token back. A ledger whose fence went backwards would hand a second
 * holder a token an evicted one already carries.
 */
export interface LeaseLedger {
  readonly leases: readonly Lease[];
  readonly fence: number;
}

export const EMPTY_LEDGER: LeaseLedger = { leases: [], fence: 0 };

export const LEASE_STATES = ["held", "expired", "unheld"] as const;

export type LeaseState = (typeof LEASE_STATES)[number];

const STATE_TEXT: Readonly<Record<LeaseState, string>> = {
  held: "a live holder, still inside its ttl",
  expired: "a holder that stopped renewing — which does not mean it stopped running",
  unheld: "no lease on record for this run",
};

export const describeLeaseState = (state: LeaseState): string => STATE_TEXT[state];

/** Where one run stands, with the arithmetic already done. */
export interface LeaseStatus {
  readonly runId: string;
  readonly state: LeaseState;
  readonly lease: Lease | null;
  /** ISO 8601. `null` when there is no lease, or its ttl or timestamps cannot be read. */
  readonly expiresAt: string | null;
  /** Milliseconds until expiry, negative once past it. `null` for the same reasons. */
  readonly remainingMs: number | null;
}

/**
 * The lease on a run, if there is one.
 *
 * First row wins, matching `resolveTarget` and `admitSwarmComments`: a ledger with two rows for one
 * run is corrupt, and `checkLedger` says so rather than this function picking a winner quietly.
 */
export function leaseOf(ledger: LeaseLedger, runId: string): Lease | null {
  const found = new Map<string, Lease>();
  for (const lease of ledger.leases) {
    if (!found.has(lease.runId)) found.set(lease.runId, lease);
  }
  return found.get(runId) ?? null;
}

/** Where a run stands against the clock. */
export function leaseStatus(ledger: LeaseLedger, runId: string, at: string): LeaseStatus {
  const lease = leaseOf(ledger, runId);
  if (lease === null) {
    return { runId, state: "unheld", lease: null, expiresAt: null, remainingMs: null };
  }

  const now = msOf(at);
  const renewed = msOf(lease.renewedAt);
  const ttlMs = durationMs(lease.ttl);
  if (now === null || renewed === null || ttlMs === null) {
    // Deliberately `held`, not `expired`. An unreadable clock is not evidence that a lease lapsed,
    // and treating it as one hands the run to a second writer on the strength of a parse failure.
    return { runId, state: "held", lease, expiresAt: null, remainingMs: null };
  }

  const expires = renewed + ttlMs;
  return {
    runId,
    state: now < expires ? "held" : "expired",
    lease,
    expiresAt: new Date(expires).toISOString(),
    remainingMs: expires - now,
  };
}

/**
 * Whether the lease a caller is holding is still the one on record.
 *
 * The compare-and-set the store performs. Holder and fence both, because a holder that reacquired
 * after being evicted is a different writer wearing the same name.
 */
export function holds(ledger: LeaseLedger, runId: string, holder: string, fence: number): boolean {
  const lease = leaseOf(ledger, runId);
  return lease !== null && lease.holder === holder && lease.fence === fence;
}

export const GRANT_OUTCOMES = ["granted", "renewed", "taken-over", "refused"] as const;

export type GrantOutcome = (typeof GRANT_OUTCOMES)[number];

const GRANT_TEXT: Readonly<Record<GrantOutcome, string>> = {
  granted: "nothing held this run; the lease is new",
  renewed: "the same holder, still inside its ttl — the fence is unchanged",
  "taken-over": "the previous lease had lapsed; the fence advanced, so its token is now stale",
  refused: "another holder is live; nothing was written",
};

export const describeGrant = (outcome: GrantOutcome): string => GRANT_TEXT[outcome];

export interface LeaseRequest {
  readonly runId: string;
  readonly holder: string;
  /** A Go duration. Empty or absent takes {@link DEFAULT_TTL}. */
  readonly ttl?: string;
}

export interface Grant {
  readonly outcome: GrantOutcome;
  /** The lease as it now stands. `null` only on `refused`. */
  readonly lease: Lease | null;
  /** The ledger that should replace the one passed in. Unchanged on `refused`. */
  readonly ledger: LeaseLedger;
  readonly previous: Lease | null;
  readonly detail: string;
}

/**
 * Take the lease on a run, or say who has it.
 *
 * A renewal keeps the fence. Nothing changed hands, so nothing downstream needs telling that its
 * token went stale — and bumping it here would invalidate the holder's own in-flight resume, which
 * is the failure this module exists to prevent, arrived at from the other direction.
 */
export function acquire(ledger: LeaseLedger, request: LeaseRequest, at: string): Grant {
  const ttl = request.ttl === undefined || request.ttl === "" ? DEFAULT_TTL : request.ttl;
  const status = leaseStatus(ledger, request.runId, at);
  const previous = status.lease;

  if (status.state === "held" && previous !== null && previous.holder !== request.holder) {
    const until = status.expiresAt === null ? "" : ` until ${status.expiresAt}`;
    return {
      outcome: "refused",
      lease: null,
      ledger,
      previous,
      detail: `held by ${previous.holder} at fence ${String(previous.fence)}${until}`,
    };
  }

  if (status.state === "held" && previous !== null) {
    const renewed: Lease = { ...previous, renewedAt: at, ttl };
    return {
      outcome: "renewed",
      lease: renewed,
      ledger: write(ledger, renewed, ledger.fence),
      previous,
      detail: `${request.holder} still holds it at fence ${String(previous.fence)}`,
    };
  }

  const fence = ledger.fence + 1;
  const lease: Lease = {
    runId: request.runId,
    holder: request.holder,
    fence,
    acquiredAt: at,
    renewedAt: at,
    ttl,
  };

  if (previous === null) {
    return {
      outcome: "granted",
      lease,
      ledger: write(ledger, lease, fence),
      previous: null,
      detail: `${request.holder} takes it at fence ${String(fence)}`,
    };
  }

  const whose = previous.holder === request.holder ? "its own lapsed lease" : `${previous.holder}`;
  return {
    outcome: "taken-over",
    lease,
    ledger: write(ledger, lease, fence),
    previous,
    detail:
      `${request.holder} takes over from ${whose} at fence ${String(fence)}; fence ` +
      `${String(previous.fence)} is now stale`,
  };
}

export interface Release {
  /** `false` both when there was nothing to release and when it belonged to somebody else. */
  readonly released: boolean;
  readonly ledger: LeaseLedger;
  readonly previous: Lease | null;
  readonly detail: string;
  /**
   * Why it was refused, in the same vocabulary as every other door, or `null` on success.
   *
   * `detail` is a sentence for a person; this is the reason a caller can branch on. A store that
   * has to tell "nothing to release" from "you were evicted" — the first is idempotent tidying, the
   * second means a live writer is still out there — cannot do it by matching on prose.
   */
  readonly problem: LeaseProblem | null;
}

/**
 * Give the lease back.
 *
 * The fence stays where it is. A released token is not returned to the pool: the holder that just
 * let go may still be mid-shutdown, and a later grant reusing its number would be indistinguishable
 * from it.
 *
 * ## Why this takes a fence
 *
 * Because it is the only function here that *deletes* a row, and the holder alone does not identify
 * a writer. Holder strings are reusable by design — the doc on `Lease.holder` names a tmux session,
 * and a tmux session name survives the restart of everything inside it. So `coord-harness` that
 * stalled and `coord-harness` that replaced it are two writers wearing one name, and the fence is
 * the only thing that tells them apart. Without it the stalled one wakes, tidies up, and deletes
 * the live one's lease: the ledger then reads `unheld` while a process is still in the worktree,
 * which is quieter than the two-writer bug this module exists for, not louder. `checkLedger` sees
 * nothing wrong with an empty ledger.
 *
 * The store's compare-and-set cannot cover this. A release does not move the fence, so the evicted
 * caller reads the ledger at the current fence, computes a delete, and writes back the same fence —
 * the CAS compares equal and succeeds. It is a well-formed write issued from a stale belief about
 * ownership, which is not the shape a CAS catches.
 *
 * Note what this deliberately still allows: releasing a lease that has *expired*, when the fence
 * still matches. An expired lease that nobody took over is exactly the case a holder should be able
 * to tidy up, and the fence having not moved is the proof that nobody did. Expiry is not the test;
 * eviction is.
 */
export function release(
  ledger: LeaseLedger,
  runId: string,
  holder: string,
  fence: number,
): Release {
  const refuse = (reason: LeaseRefusal, previous: Lease | null, message: string): Release => ({
    released: false,
    ledger,
    previous,
    detail: message,
    problem: { reason, message, runId },
  });

  const previous = leaseOf(ledger, runId);
  if (previous === null) {
    return refuse("no-lease", null, "no lease on record");
  }
  if (previous.holder !== holder) {
    return refuse(
      "held-by-another",
      previous,
      `held by ${previous.holder}, not ${holder} — nothing was written`,
    );
  }
  if (previous.fence !== fence) {
    return refuse(
      "stale-fence",
      previous,
      `${holder} presents fence ${String(fence)}, but the lease on record is at ` +
        `${String(previous.fence)} — this caller was evicted and something else holds it now; ` +
        "nothing was written",
    );
  }
  return {
    released: true,
    ledger: { leases: ledger.leases.filter((lease) => lease.runId !== runId), fence: ledger.fence },
    previous,
    detail: `${holder} released it; fence stays at ${String(ledger.fence)}`,
    problem: null,
  };
}

export const RESOLUTIONS = ["resolved", "ambiguous", "unmatched", "absent"] as const;

export type Resolution = (typeof RESOLUTIONS)[number];

const RESOLUTION_TEXT: Readonly<Record<Resolution, string>> = {
  resolved: "one transcript carries the marker and is newer than the rest",
  ambiguous: "two transcripts carry the marker and share the newest modification time",
  unmatched: "transcripts were observed, and none of them carries the marker",
  absent: "no transcripts were observed at all",
};

export const describeResolution = (outcome: Resolution): string => RESOLUTION_TEXT[outcome];

export interface SessionResolution {
  readonly outcome: Resolution;
  /** Non-null only on `resolved`. */
  readonly session: TranscriptFile | null;
  /** What was actually searched for. */
  readonly marker: string;
  readonly considered: number;
  readonly matched: number;
  /** The next-newest match, so an ambiguous result can be shown rather than only counted. */
  readonly runnerUp: TranscriptFile | null;
  readonly detail: string;
}

export interface ResolveRequest {
  readonly runId: string;
  readonly candidates: readonly TranscriptFile[];
  /** What the dispatch wrote into the transcript. Empty or absent searches for the run id itself. */
  readonly marker?: string;
}

/**
 * Find the vendor session for a run, by looking rather than by remembering.
 *
 * Newest modification time among the tails that carry the marker. Both halves are load-bearing:
 * mtime alone picks whichever agent wrote last, marker alone cannot tell an abandoned transcript
 * from the live one after `--resume` minted a second id for the same run.
 */
export function resolveSession(request: ResolveRequest): SessionResolution {
  const marker =
    request.marker === undefined || request.marker === "" ? request.runId : request.marker;
  const considered = request.candidates.length;
  const base = { marker, considered, session: null, runnerUp: null } as const;

  if (considered === 0) {
    return { ...base, outcome: "absent", matched: 0, detail: "no transcripts were observed" };
  }

  const matched = marker === "" ? [] : request.candidates.filter((file) => file.tail.includes(marker));
  if (matched.length === 0) {
    const what = marker === "" ? "an empty marker" : JSON.stringify(marker);
    return {
      ...base,
      outcome: "unmatched",
      matched: 0,
      detail: `none of the ${String(considered)} transcript(s) carry ${what} in their tail`,
    };
  }

  // Not `b - a`: an unreadable timestamp ranks as -Infinity, and `-Infinity - -Infinity` is NaN,
  // which makes a comparator's result undefined and the sort order platform-dependent.
  const ranked = [...matched].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    if (a === b) return 0;
    return a < b ? 1 : -1;
  });

  const newest = ranked[0];
  if (newest === undefined) {
    return { ...base, outcome: "unmatched", matched: 0, detail: "no transcript survived ranking" };
  }
  const runnerUp = ranked[1] ?? null;

  if (runnerUp !== null && rank(runnerUp) === rank(newest)) {
    return {
      ...base,
      outcome: "ambiguous",
      matched: matched.length,
      runnerUp,
      detail:
        `${newest.path} and ${runnerUp.path} both carry the marker and report ` +
        `${newest.modifiedAt} — nothing here distinguishes them`,
    };
  }

  return {
    ...base,
    outcome: "resolved",
    session: newest,
    matched: matched.length,
    runnerUp,
    detail:
      `${newest.sessionId} at ${newest.path}, modified ${newest.modifiedAt} ` +
      `(${String(matched.length)} of ${String(considered)} matched)`,
  };
}

export const LEASE_REFUSALS = [
  /** `at` did not parse, so nothing was decided. */
  "clock-unreadable",
  /** The join key is empty. Everything downstream keys on it, so nothing can proceed. */
  "no-run-id",
  /** A lease with no holder names nobody to refuse a second writer on behalf of. */
  "no-holder",
  /** Two rows for one run: the ledger cannot say who holds it. */
  "duplicate-lease",
  /** A lease carries a fence above the ledger's own, so the next grant would reissue a live token. */
  "fence-regressed",
  /** A ttl Go would reject. The lease never expires, which is the same as no lease at all. */
  "ttl-not-a-duration",
  /** A resume with no lease behind it. */
  "no-lease",
  /** The holder stopped renewing. It has not necessarily stopped running. */
  "lease-expired",
  /** Somebody else holds it. This is the 4090 case, caught before the second process starts. */
  "held-by-another",
  /** The fence presented is not the one on record — an evicted holder waking up. */
  "stale-fence",
  /** Nothing was observed to resume into. */
  "session-absent",
  /** Transcripts exist and none is ours. */
  "session-unmatched",
  /** Two equal claims on the newest transcript. */
  "session-ambiguous",
  /** The run id is a vendor session id, which is the identifier this module exists not to key on. */
  "keyed-on-vendor-id",
  /** A transcript timestamp did not parse, so "newest" was decided without it. */
  "mtime-unreadable",
  /** The resolved transcript has not moved in a long time. Admitted, but worth a look. */
  "transcript-stale",
] as const;

export type LeaseRefusal = (typeof LEASE_REFUSALS)[number];

export interface LeaseProblem {
  readonly reason: LeaseRefusal;
  readonly message: string;
  /** The run it is about, or `null` for a whole-ledger problem. */
  readonly runId: string | null;
}

export const describeLeaseProblem = (problem: LeaseProblem): string =>
  problem.runId === null ? problem.message : `${problem.runId}: ${problem.message}`;

/**
 * What is wrong with the ledger itself, before anybody asks it a question.
 *
 * Integrity only: this says nothing about whether a particular resume should go ahead. Composition
 * time can run it over a loaded file with no run in flight.
 */
export function checkLedger(ledger: LeaseLedger, at: string): readonly LeaseProblem[] {
  const problems: LeaseProblem[] = [];
  const say = (reason: LeaseRefusal, runId: string | null, message: string): void => {
    problems.push({ reason, message, runId });
  };

  if (msOf(at) === null) {
    say(
      "clock-unreadable",
      null,
      `'${at}' is not a timestamp — every expiry here is arithmetic against the clock, so no lease ` +
        "was aged and each one reads as held",
    );
  }

  const seen = new Set<string>();
  for (const lease of ledger.leases) {
    if (lease.runId === "") {
      say("no-run-id", null, "a lease has an empty run id; nothing can be keyed on it");
    } else if (seen.has(lease.runId)) {
      say(
        "duplicate-lease",
        lease.runId,
        "appears more than once; the first row is used and the rest are ignored, so the ledger " +
          "does not say who holds this run",
      );
    } else {
      seen.add(lease.runId);
    }

    const runId = lease.runId === "" ? null : lease.runId;

    if (lease.holder === "") {
      say("no-holder", runId, "the lease names no holder, so nothing can be refused on its behalf");
    }

    if (durationMs(lease.ttl) === null) {
      say(
        "ttl-not-a-duration",
        runId,
        `ttl '${lease.ttl}' is not a Go duration, so this lease never expires and a stalled holder ` +
          "keeps the run forever",
      );
    }

    if (lease.fence > ledger.fence) {
      say(
        "fence-regressed",
        runId,
        `carries fence ${String(lease.fence)} above the ledger's ${String(ledger.fence)} — the next ` +
          "grant would reissue a token that is already live",
      );
    }
  }

  return problems;
}

export interface ResumeAttempt {
  readonly runId: string;
  readonly holder: string;
  /** The fence the caller believes it holds. */
  readonly fence: number;
  readonly candidates: readonly TranscriptFile[];
  readonly marker?: string;
  /** A Go duration. How long a transcript may sit still before it is worth a second look. */
  readonly stale?: string;
}

export interface ResumeDecision {
  readonly runId: string;
  readonly holder: string;
  readonly admitted: boolean;
  readonly state: LeaseState;
  /** The fence on record, or `0` when nothing holds the run. */
  readonly fence: number;
  readonly resolution: SessionResolution;
  /** The transcript to resume into. Non-null only when admitted. */
  readonly session: TranscriptFile | null;
  readonly reasons: readonly LeaseProblem[];
}

/**
 * Decide whether this caller may resume this run, right now.
 *
 * Every reason is collected rather than the first one returned. A caller told only "no lease" fixes
 * that, retries, and is told "session ambiguous" — two round trips to learn what one answer could
 * have carried, and in between, an operator who has started guessing.
 *
 * `transcript-stale` and `mtime-unreadable` are reported without blocking. Both are real signals
 * and neither is evidence that a second writer exists, which is the only thing this gate is for.
 */
export function admitResume(
  ledger: LeaseLedger,
  attempt: ResumeAttempt,
  at: string,
): ResumeDecision {
  const reasons: LeaseProblem[] = [];
  const runId = attempt.runId;
  const say = (reason: LeaseRefusal, message: string): void => {
    reasons.push({ reason, message, runId: runId === "" ? null : runId });
  };

  const now = msOf(at);
  if (now === null) {
    say(
      "clock-unreadable",
      `'${at}' is not a timestamp, so the lease could not be aged and this resume was not decided`,
    );
  }
  if (runId === "") say("no-run-id", "the attempt names no run");
  if (attempt.holder === "") say("no-holder", "the attempt names no holder");

  // Criterion 2, made checkable without guessing at id formats: if our key is one of the vendor's
  // own session ids, we are keying on the identifier that changes under `--resume`.
  const impostor = attempt.candidates.some((file) => file.sessionId !== "" && file.sessionId === runId);
  if (impostor) {
    say(
      "keyed-on-vendor-id",
      `is also a vendor session id in the observed transcripts — runs are keyed on our run id, ` +
        "which exists before the run and does not change when the vendor mints a new session",
    );
  }

  const status = leaseStatus(ledger, runId, at);
  const lease = status.lease;

  if (lease === null) {
    say("no-lease", "no lease on record — acquire one before resuming");
  } else {
    if (lease.holder !== attempt.holder) {
      say(
        "held-by-another",
        `held by ${lease.holder}, not ${attempt.holder}${status.expiresAt === null ? "" : ` until ${status.expiresAt}`}` +
          " — resuming now is how two processes end up on one session",
      );
    }
    if (status.state === "expired") {
      say(
        "lease-expired",
        `stopped being renewed at ${lease.renewedAt} (ttl ${lease.ttl}) — take it over before ` +
          "resuming, so the fence advances past whatever the old holder is carrying",
      );
    }
    if (attempt.fence !== lease.fence) {
      say(
        "stale-fence",
        `presented fence ${String(attempt.fence)}; the ledger holds ${String(lease.fence)} — this ` +
          "caller was evicted while it was away",
      );
    }
  }

  const resolveRequest: ResolveRequest =
    attempt.marker === undefined
      ? { runId, candidates: attempt.candidates }
      : { runId, candidates: attempt.candidates, marker: attempt.marker };
  const resolution = resolveSession(resolveRequest);

  switch (resolution.outcome) {
    case "absent":
      say("session-absent", "no transcript was observed, so there is nothing to resume into");
      break;
    case "unmatched":
      say("session-unmatched", resolution.detail);
      break;
    case "ambiguous":
      say("session-ambiguous", resolution.detail);
      break;
    case "resolved":
      break;
  }

  if (resolution.matched > 0) {
    const unreadable = attempt.candidates.filter(
      (file) => file.tail.includes(resolution.marker) && msOf(file.modifiedAt) === null,
    );
    for (const file of unreadable) {
      say(
        "mtime-unreadable",
        `${file.path} reports '${file.modifiedAt}', which is not a timestamp — it ranked oldest ` +
          "rather than being excluded, so 'newest' was decided without it",
      );
    }
  }

  const session = resolution.session;
  if (session !== null && now !== null) {
    const staleMs = durationMs(
      attempt.stale === undefined || attempt.stale === "" ? DEFAULT_STALE : attempt.stale,
    );
    const modified = msOf(session.modifiedAt);
    if (staleMs !== null && modified !== null && now - modified >= staleMs) {
      say(
        "transcript-stale",
        `${session.path} has not changed since ${session.modifiedAt} — it is the best match, and ` +
          "it may be a finished run rather than the one being resumed",
      );
    }
  }

  const blocking = reasons.some((problem) => !ADVISORY.some((reason) => reason === problem.reason));

  return {
    runId,
    holder: attempt.holder,
    admitted: !blocking && session !== null,
    state: status.state,
    fence: lease?.fence ?? 0,
    resolution,
    session: blocking ? null : session,
    reasons,
  };
}

/** Reported, never blocking: neither is evidence that a second writer exists. */
const ADVISORY: readonly LeaseRefusal[] = ["transcript-stale", "mtime-unreadable"];

/** Whether a refusal blocks a resume or is only worth saying out loud. */
export const isAdvisory = (reason: LeaseRefusal): boolean =>
  ADVISORY.some((advisory) => advisory === reason);

/**
 * Replace one run's row and set the fence.
 *
 * Every row for the run is dropped, not just the first. A ledger with duplicates is corrupt and
 * `checkLedger` is what reports it; leaving the extras behind on a write would compound the
 * corruption with a row that disagrees with the one just written.
 */
function write(ledger: LeaseLedger, lease: Lease, fence: number): LeaseLedger {
  return {
    leases: [...ledger.leases.filter((row) => row.runId !== lease.runId), lease],
    fence,
  };
}

/** Milliseconds, or `null` for anything `Date.parse` will not read. */
function msOf(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** A Go duration in milliseconds, or `null` for anything Go would reject. */
function durationMs(text: string): number | null {
  const ns = parseGoDuration(text);
  return ns === null ? null : ns / 1e6;
}

/** A transcript's modification time for ordering. Unreadable sorts oldest, and is reported. */
function rank(file: TranscriptFile): number {
  return msOf(file.modifiedAt) ?? Number.NEGATIVE_INFINITY;
}
