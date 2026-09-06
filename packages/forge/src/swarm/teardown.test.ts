import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SourceIssue } from "@rickylabs/board";

import type { Target, TargetTable } from "./../targets/model.js";
import type { BridgeSource } from "./../targets/reconcile.js";
import { renderTeardown } from "./teardown-render.js";
import type {
  Artefact,
  InboxIssue,
  RunObservation,
  Teardown,
  TeardownInput,
  TeardownProblem,
  TeardownRefusal,
  TeardownVerdict,
} from "./teardown.js";
import {
  TEARDOWN_EVIDENCE,
  TEARDOWN_REFUSALS,
  TEARDOWN_STATES,
  checkTeardown,
  describeTeardownEvidence,
  describeTeardownProblem,
  describeTeardownState,
  inboxIssues,
  planTeardown,
  span,
  tallyTeardown,
} from "./teardown.js";

const TARGET_REPO = "denoland/deno";
const INBOX = "rickylabs/harness";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The tick's clock. Everything below is stated as a distance from it, never as a wall time. */
const NOW = "2026-03-01T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const ago = (ms: number): string => new Date(NOW_MS - ms).toISOString();

const REF = `${TARGET_REPO}#42`;
const ref = (number: number): string => `${TARGET_REPO}#${String(number)}`;

const target = (over: Partial<Target> = {}): Target => ({
  label: "harness",
  repo: TARGET_REPO,
  agents: ["claude"],
  automerge: false,
  priority: 0,
  disabled: false,
  ...over,
});

const table = (over: Partial<TargetTable> = {}): TargetTable => ({
  inbox: INBOX,
  botLogin: "divybot",
  branchPrefix: "orch/divybot-",
  pollInterval: "30s",
  targets: [target()],
  memory: { enabled: false, repo: INBOX, branch: "main", dir: "memory", interval: "5m" },
  ...over,
});

const artefact = (over: Partial<Artefact> = {}): Artefact => ({
  path: ".llm/transcript.jsonl",
  at: NOW,
  bytes: 41_000,
  ...over,
});

/** A run an hour into a four-hour deadline, writing right now. The ordinary world. */
const run = (over: Partial<RunObservation> = {}): RunObservation => ({
  ref: REF,
  harness: "claude",
  startedAt: ago(HOUR),
  timeout: "4h",
  artefacts: [artefact()],
  exited: false,
  ...over,
});

const mirror = (over: Partial<InboxIssue> = {}): InboxIssue => ({ number: 7, ref: REF, open: true, ...over });

const plan = (over: Partial<TeardownInput> = {}, tableOver: Partial<TargetTable> = {}): Teardown =>
  planTeardown(table(tableOver), { at: NOW, runs: [run()], inbox: [mirror()], ...over });

const only = (over: Partial<TeardownInput> = {}): TeardownVerdict => {
  const verdict = plan(over).verdicts[0];
  if (verdict === undefined) throw new Error("expected exactly one verdict");
  return verdict;
};

const withRun = (over: Partial<RunObservation>): TeardownVerdict => only({ runs: [run(over)] });

const reasons = (problems: readonly TeardownProblem[]): readonly TeardownRefusal[] =>
  problems.map((problem) => problem.reason);

describe("what teardown rests on", () => {
  it("never calls a run stopped on its own word for it", () => {
    // The failure #77 was opened for: three agents reported an exit while their process trees were
    // still writing. `exited` decides `settling` and nothing beyond it.
    const verdict = withRun({ exited: true });
    assert.equal(verdict.state, "settling");
    assert.equal(verdict.evidence, "artefact");
    assert.deepEqual(verdict.steps, ["verify", "close"]);
  });

  it("does not call a run stopped when nothing at all was observed", () => {
    const verdict = withRun({ exited: true, artefacts: [] });
    assert.equal(verdict.state, "settling");
    assert.equal(verdict.evidence, "claim");
    assert.equal(verdict.quietMs, null);
  });

  it("calls it stopped once every artefact has been still for the settle window", () => {
    const verdict = withRun({ artefacts: [artefact({ at: ago(5 * MINUTE) })] });
    assert.equal(verdict.state, "stopped");
    assert.equal(verdict.evidence, "artefact");
    assert.deepEqual(verdict.steps, ["close"]);
  });

  it("holds one millisecond short of the window", () => {
    const verdict = withRun({ artefacts: [artefact({ at: ago(5 * MINUTE - 1) })] });
    assert.equal(verdict.state, "running");
    assert.equal(verdict.quietMs, 5 * MINUTE - 1);
  });

  it("measures quiet from the newest artefact, not the first listed", () => {
    const verdict = withRun({
      artefacts: [artefact({ path: "old.log", at: ago(2 * HOUR) }), artefact({ path: "new.log", at: ago(MINUTE) })],
    });
    assert.equal(verdict.newest?.path, "new.log");
    assert.equal(verdict.quietMs, MINUTE);
  });

  it("skips an artefact whose timestamp does not parse rather than reading it as the newest", () => {
    const verdict = withRun({
      artefacts: [artefact({ path: "broken.log", at: "whenever" }), artefact({ path: "real.log", at: ago(MINUTE) })],
    });
    assert.equal(verdict.newest?.path, "real.log");
  });

  it("reads an artefact stamped in the future as skew rather than as negative quiet", () => {
    const verdict = withRun({ artefacts: [artefact({ at: new Date(NOW_MS + HOUR).toISOString() })] });
    assert.equal(verdict.quietMs, 0);
    assert.equal(verdict.state, "running");
  });
});

describe("the deadline", () => {
  it("is advisory: a run that finished early is stopped before it", () => {
    const verdict = withRun({ timeout: "8h", artefacts: [artefact({ at: ago(30 * MINUTE) })] });
    assert.equal(verdict.overdueMs, 0);
    assert.equal(verdict.state, "stopped");
  });

  it("is advisory the other way too: past it and still writing is expired, never stopped", () => {
    const verdict = withRun({ startedAt: ago(5 * HOUR) });
    assert.equal(verdict.state, "expired");
    assert.equal(verdict.overdueMs, HOUR);
    assert.deepEqual(verdict.steps, ["stop", "verify", "close"]);
  });

  it("falls back to the default when the block names no timeout, and says it did", () => {
    const verdict = withRun({ timeout: "" });
    assert.equal(verdict.defaulted, true);
    assert.equal(verdict.deadline, new Date(NOW_MS - HOUR + 4 * HOUR).toISOString());
  });

  it("takes the default deadline the caller names over this module's own", () => {
    const verdict = only({ runs: [run({ timeout: "" })], defaultTimeout: "30m" });
    assert.equal(verdict.overdueMs, 30 * MINUTE);
  });

  it("discards an unparseable timeout onto the default, exactly as upstream does", () => {
    const verdict = withRun({ timeout: "soon" });
    assert.equal(verdict.defaulted, true);
    assert.equal(verdict.timeout, "soon", "echoed back verbatim — the refusal is where it is judged");
  });

  it("leaves no deadline at all when the start did not parse", () => {
    const verdict = withRun({ startedAt: "whenever" });
    assert.equal(verdict.deadline, null);
    assert.equal(verdict.overdueMs, null);
  });
});

describe("the inbox issue", () => {
  it("drops the close step when nothing mirrors the ref", () => {
    const verdict = only({ runs: [run({ startedAt: ago(5 * HOUR) })], inbox: [] });
    assert.equal(verdict.inboxIssue, null);
    assert.deepEqual(verdict.steps, ["stop", "verify"]);
  });

  it("reports a still run outside the pipeline as complete, since there is nothing left to close", () => {
    const verdict = only({ runs: [run({ artefacts: [artefact({ at: ago(HOUR) })] })], inbox: [] });
    assert.equal(verdict.state, "closed");
    assert.deepEqual(verdict.steps, []);
  });

  it("is complete once the mirror is closed", () => {
    const verdict = only({
      runs: [run({ artefacts: [artefact({ at: ago(HOUR) })] })],
      inbox: [mirror({ open: false })],
    });
    assert.equal(verdict.state, "closed");
    assert.deepEqual(verdict.steps, []);
  });

  it("reports an open mirror no run claims, and asks for nothing", () => {
    const teardown = plan({ runs: [], inbox: [mirror({ number: 9 })] });
    const verdict = teardown.verdicts[0];
    assert.equal(verdict?.state, "orphaned");
    assert.equal(verdict?.inboxIssue, 9);
    assert.deepEqual(verdict?.steps, [], "this command cannot tell a wedged run's leftovers from unreached work");
  });

  it("says nothing about a closed mirror no run claims — that is teardown having worked", () => {
    assert.deepEqual(plan({ runs: [], inbox: [mirror({ open: false })] }).verdicts, []);
  });

  it("takes the first entry for a ref, matching the rest of the package", () => {
    const verdict = only({ inbox: [mirror({ number: 7 }), mirror({ number: 8 })] });
    assert.equal(verdict.inboxIssue, 7);
  });
});

describe("planTeardown", () => {
  it("decides nothing at all when its own clock does not parse", () => {
    const teardown = plan({ at: "not a timestamp" });
    assert.deepEqual(teardown.verdicts, []);
    assert.deepEqual(teardown.duplicates, []);
    assert.equal(teardown.at, "not a timestamp", "echoed back, so a verdict says which clock produced it");
  });

  it("keeps the first of a repeated ref and records the rest", () => {
    const teardown = plan({ runs: [run(), run({ harness: "codex" })] });
    assert.equal(teardown.verdicts.length, 1);
    assert.equal(teardown.verdicts[0]?.harness, "claude");
    assert.deepEqual(teardown.duplicates, [REF]);
  });

  it("falls back to its own settle window when the caller's is not a duration", () => {
    assert.equal(plan({ settle: "soonish" }).settleMs, 5 * MINUTE);
    assert.equal(plan({ stuck: "soonish" }).stuckMs, HOUR);
  });

  it("honours a settle window the caller does name", () => {
    const teardown = planTeardown(table(), {
      at: NOW,
      runs: [run({ artefacts: [artefact({ at: ago(MINUTE) })] })],
      inbox: [mirror()],
      settle: "30s",
    });
    assert.equal(teardown.verdicts[0]?.state, "stopped");
  });

  it("reaches every state in the closed set", () => {
    const teardown = plan({
      runs: [
        run(),
        run({ ref: ref(43), startedAt: ago(5 * HOUR) }),
        run({ ref: ref(44), exited: true, artefacts: [] }),
        run({ ref: ref(45), artefacts: [artefact({ at: ago(10 * MINUTE) })] }),
        run({ ref: ref(46), artefacts: [artefact({ at: ago(10 * MINUTE) })] }),
      ],
      inbox: [
        mirror(),
        mirror({ number: 8, ref: ref(43) }),
        mirror({ number: 9, ref: ref(44) }),
        mirror({ number: 10, ref: ref(45) }),
        mirror({ number: 11, ref: ref(46), open: false }),
        mirror({ number: 12, ref: ref(47) }),
      ],
    });
    assert.deepEqual(new Set(teardown.verdicts.map((verdict) => verdict.state)), new Set(TEARDOWN_STATES));
  });

  it("reaches every evidence value in the closed set", () => {
    const teardown = plan({
      runs: [run(), run({ ref: ref(43), artefacts: [], exited: true }), run({ ref: ref(44), artefacts: [] })],
      inbox: [],
    });
    assert.deepEqual(new Set(teardown.verdicts.map((verdict) => verdict.evidence)), new Set(TEARDOWN_EVIDENCE));
  });
});

describe("inboxIssues", () => {
  const item = (number: number, over: Partial<SourceIssue> = {}): SourceIssue => ({
    number,
    title: `[${REF}] fix the thing`,
    state: "open",
    labels: [],
    url: `https://github.com/${INBOX}/issues/${String(number)}`,
    assignees: [],
    milestone: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    kind: "issue",
    ...over,
  });
  const source = (repo: string, items: readonly SourceIssue[]): BridgeSource => ({ repo, items });

  it("reads the ref out of the mirror title", () => {
    assert.deepEqual(inboxIssues(table(), [source(INBOX, [item(7)])]), [{ number: 7, ref: REF, open: true }]);
  });

  it("keeps closed mirrors, because a closed one is what says teardown finished", () => {
    assert.deepEqual(inboxIssues(table(), [source(INBOX, [item(7, { state: "closed" })])]), [
      { number: 7, ref: REF, open: false },
    ]);
  });

  it("ignores a projection of any repository but the inbox", () => {
    assert.deepEqual(inboxIssues(table(), [source(TARGET_REPO, [item(7)])]), []);
  });

  it("ignores a pull request whose title happens to start like a mirror", () => {
    assert.deepEqual(inboxIssues(table(), [source(INBOX, [item(7, { kind: "pull-request" })])]), []);
  });

  it("ignores an inbox issue that mirrors nothing", () => {
    assert.deepEqual(inboxIssues(table(), [source(INBOX, [item(7, { title: "housekeeping" })])]), []);
  });
});

describe("tallyTeardown", () => {
  it("counts runs and orphans apart, because an orphan is not a run", () => {
    const tally = tallyTeardown(plan({ runs: [run()], inbox: [mirror(), mirror({ number: 8, ref: ref(43) })] }));
    assert.equal(tally.runs, 1);
    assert.equal(tally.orphans, 1);
    assert.equal(tally.running, 1);
  });

  it("counts the criterion: how many verdicts rest on something other than a measurement", () => {
    const tally = tallyTeardown(
      plan({
        runs: [run(), run({ ref: ref(43), artefacts: [], exited: true })],
        inbox: [mirror(), mirror({ number: 8, ref: ref(43) }), mirror({ number: 9, ref: ref(44) })],
      }),
    );
    assert.equal(tally.unverified, 1, "the orphan does not count — it has no run to have measured");
    assert.equal(tally.settling, 1);
  });
});

describe("checkTeardown", () => {
  it("stays silent on a fleet that is simply working", () => {
    assert.deepEqual(checkTeardown(plan()), []);
  });

  it("stays silent on a run already torn down and closed", () => {
    const teardown = plan({
      runs: [run({ artefacts: [artefact({ at: ago(HOUR) })] })],
      inbox: [mirror({ open: false })],
    });
    assert.deepEqual(checkTeardown(teardown), []);
  });

  it("names the file that kept moving after the harness said it had exited", () => {
    const problems = checkTeardown(plan({ runs: [run({ exited: true })] }));
    assert.deepEqual(reasons(problems), ["exit-without-quiet"]);
    assert.match(problems[0]?.message ?? "", /transcript\.jsonl changed 0s ago/);
  });

  it("does not say that twice about one wedged run", () => {
    // `exit-without-quiet` and `unwitnessed-teardown` are exclusive by construction: one run must
    // not print as two unrelated red lines.
    const problems = checkTeardown(plan({ runs: [run({ exited: true, artefacts: [] })] }));
    assert.deepEqual(reasons(problems), ["unwitnessed-teardown"]);
  });

  it("says when nothing is enforcing the deadline at all", () => {
    const problems = checkTeardown(plan({ runs: [run({ startedAt: ago(6 * HOUR) })] }));
    assert.deepEqual(reasons(problems), ["teardown-stuck"]);
    assert.match(problems[0]?.message ?? "", /2h 00m past its own deadline/);
  });

  it("says an orphaned mirror will be re-dispatched, and refuses to guess", () => {
    const problems = checkTeardown(plan({ runs: [], inbox: [mirror({ number: 9 })] }));
    assert.deepEqual(reasons(problems), ["orphaned-inbox-issue"]);
    assert.match(problems[0]?.message ?? "", /#9 is open and no run claims it/);
  });

  it("says a run's teardown has no target", () => {
    assert.deepEqual(reasons(checkTeardown(plan({ inbox: [] }))), ["run-without-inbox-issue"]);
  });

  it("says a timeout was written and discarded", () => {
    const problems = checkTeardown(plan({ runs: [run({ timeout: "soon" })] }));
    assert.deepEqual(reasons(problems), ["timeout-not-a-duration"]);
    assert.match(problems[0]?.message ?? "", /'timeout: soon' is not a Go duration/);
  });

  it("says a deadline is unreachable because the start did not parse", () => {
    const problems = checkTeardown(plan({ runs: [run({ startedAt: "whenever" })] }));
    assert.deepEqual(reasons(problems), ["deadline-unreachable"]);
    assert.match(problems[0]?.message ?? "", /is not a timestamp/);
  });

  it("says a deadline is unreachable because the clocks disagree", () => {
    const problems = checkTeardown(plan({ runs: [run({ startedAt: new Date(NOW_MS + 2 * HOUR).toISOString() })] }));
    assert.deepEqual(reasons(problems), ["deadline-unreachable"]);
    assert.match(problems[0]?.message ?? "", /it starts 2h 00m from now/);
  });

  it("says a ref arrived twice and the second was dropped", () => {
    assert.deepEqual(reasons(checkTeardown(plan({ runs: [run(), run()] }))), ["duplicate-run"]);
  });

  it("says an unreadable clock decided nothing, and stops there", () => {
    const problems = checkTeardown(plan({ at: "not a timestamp", runs: [run(), run()] }));
    assert.deepEqual(reasons(problems), ["clock-unreadable"]);
  });

  it("reaches every refusal in the closed set", () => {
    const problems = checkTeardown(
      plan({
        runs: [
          run({ exited: true }),
          run({ ref: ref(43), artefacts: [], exited: true }),
          run({ ref: ref(44), startedAt: ago(6 * HOUR) }),
          run({ ref: ref(45) }),
          run({ ref: ref(46), timeout: "soon" }),
          run({ ref: ref(47), startedAt: "whenever" }),
          run({ ref: ref(48) }),
          run({ ref: ref(48) }),
        ],
        inbox: [
          mirror(),
          mirror({ number: 8, ref: ref(43) }),
          mirror({ number: 9, ref: ref(44) }),
          mirror({ number: 11, ref: ref(46) }),
          mirror({ number: 12, ref: ref(47) }),
          mirror({ number: 13, ref: ref(48) }),
          mirror({ number: 14, ref: ref(49) }),
        ],
      }),
    );
    // The clock refusal returns early by design, so it cannot share a tick with the other eight.
    const clock = checkTeardown(plan({ at: "not a timestamp" }));
    assert.deepEqual(new Set([...reasons(problems), ...reasons(clock)]), new Set(TEARDOWN_REFUSALS));
  });
});

describe("closed sets", () => {
  it("describes every state", () => {
    for (const state of TEARDOWN_STATES) assert.ok(describeTeardownState(state).length > 0, state);
  });

  it("describes every evidence value", () => {
    for (const evidence of TEARDOWN_EVIDENCE) assert.ok(describeTeardownEvidence(evidence).length > 0, evidence);
  });

  it("leads a problem with the ref when there is one", () => {
    assert.equal(describeTeardownProblem({ reason: "duplicate-run", message: "twice", ref: REF }), `${REF}: twice`);
    assert.equal(describeTeardownProblem({ reason: "clock-unreadable", message: "no clock", ref: null }), "no clock");
  });
});

describe("span", () => {
  it("says nothing rather than zero when there is nothing to say", () => {
    assert.equal(span(null), "—");
  });

  it("never prints more than two units", () => {
    assert.equal(span(45_000), "45s");
    assert.equal(span(12 * MINUTE + 3_000), "12m 03s");
    assert.equal(span(2 * HOUR + 5 * MINUTE), "2h 05m");
    assert.equal(span(3 * 24 * HOUR + 4 * HOUR), "3d 04h");
  });
});

describe("renderTeardown", () => {
  const busy = (): Teardown =>
    plan({
      runs: [
        run({ startedAt: ago(5 * HOUR) }),
        run({ ref: ref(43), exited: true }),
        run({ ref: ref(44), artefacts: [artefact({ at: ago(10 * MINUTE) })] }),
        run({ ref: ref(45), artefacts: [] }),
      ],
      inbox: [
        mirror(),
        mirror({ number: 8, ref: ref(43) }),
        mirror({ number: 9, ref: ref(44) }),
        mirror({ number: 10, ref: ref(45) }),
        mirror({ number: 11, ref: ref(46) }),
      ],
    });

  const out = (): string => renderTeardown(busy(), checkTeardown(busy()));

  it("leads with the counts the operator asked 'status ?' for", () => {
    assert.match(out(), /rickylabs\/harness ← 4 run\(s\) · 1 expired · 1 settling · 1 to close · 1 orphan\(s\)/);
  });

  it("stamps the clock it judged against, so a pasted verdict stays true", () => {
    assert.ok(out().includes(`at ${NOW} · settle 5m 00s · stuck after 1h 00m`));
  });

  it("orders sections by what is owed, not by state name", () => {
    const text = out();
    const order = ["expired (1)", "settling (1)", "stopped (1)", "orphaned (1)"].map((mark) => text.indexOf(mark));
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.ok(order.every((index) => index > 0));
  });

  it("carries the evidence on every line it asks for work on", () => {
    assert.match(out(), /evidence {2}artefact {2}\.llm\/transcript\.jsonl \(41\.0kb\) {2}quiet 10m 00s/);
  });

  it("gives the deadline as a moment, and says where it came from", () => {
    assert.match(out(), /deadline {2}2026-03-01T11:00:00\.000Z {2}timeout 4h {2}overdue 1h 00m/);
  });

  it("prints what is owed in the order it is owed", () => {
    const text = out();
    assert.ok(text.includes("owed  stop → verify → close"));
    assert.ok(text.includes("owed  close"));
  });

  it("collapses what is not owed anything into a count", () => {
    const text = renderTeardown(plan(), []);
    assert.ok(text.includes("nothing owed"));
    assert.match(text, /\s+1\s+running/);
  });

  it("counts unverified runs ahead of the refusals, because that is the criterion", () => {
    const text = out();
    const unverified = text.indexOf("rest on something other than an artefact");
    assert.ok(unverified > 0);
    assert.ok(text.indexOf("problem(s)") > unverified);
  });

  it("says an orphan has no run rather than printing a deadline it does not have", () => {
    const text = renderTeardown(plan({ runs: [], inbox: [mirror({ number: 9 })] }), []);
    assert.ok(text.includes("inbox#9"));
    assert.ok(!text.includes("deadline"));
  });
});
