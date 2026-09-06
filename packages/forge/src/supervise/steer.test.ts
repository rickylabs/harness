import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Target, TargetTable } from "../targets/model.js";
import {
  EMPTY_STATE,
  PULL_SIGNALS,
  SUPERVISION_REASONS,
  SUPERVISION_REFUSALS,
  advanceState,
  checkSupervision,
  describeSupervisionProblem,
  describeSupervisionReason,
  pullKey,
  supervisePulls,
  tallySupervision,
} from "./steer.js";
import type {
  PaneRead,
  PullCheck,
  PullReview,
  SeenPull,
  Supervision,
  SupervisedPull,
  SupervisionInput,
  SupervisionRefusal,
  SupervisionState,
  SupervisionVerdict,
} from "./steer.js";

const target = (over: Partial<Target> = {}): Target => ({
  label: "harness",
  repo: "rickylabs/harness",
  agents: ["claude"],
  automerge: false,
  priority: 0,
  disabled: false,
  ...over,
});

const table = (over: Partial<TargetTable> = {}): TargetTable => ({
  inbox: "rickylabs/harness",
  botLogin: "divybot",
  branchPrefix: "orch/divybot-",
  pollInterval: "30s",
  targets: [target()],
  memory: { enabled: false, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" },
  ...over,
});

const pull = (over: Partial<SupervisedPull> = {}): SupervisedPull => ({
  repo: "rickylabs/harness",
  number: 169,
  url: "https://github.com/rickylabs/harness/pull/169",
  headSha: "6a65359",
  mergeable: "MERGEABLE",
  draft: false,
  reviews: [],
  checks: [],
  ...over,
});

const review = (over: Partial<PullReview> = {}): PullReview => ({
  id: "r1",
  author: "kmiller",
  state: "CHANGES_REQUESTED",
  submittedAt: "2026-09-06T10:00:00Z",
  body: "the ledger reads oddly",
  ...over,
});

const check = (over: Partial<PullCheck> = {}): PullCheck => ({
  id: "c1",
  name: "build",
  conclusion: "failure",
  url: "https://github.com/rickylabs/harness/actions/runs/1/job/2",
  ...over,
});

const pane = (over: Partial<PaneRead> = {}): PaneRead => ({
  repo: "rickylabs/harness",
  number: 169,
  busy: false,
  text: "$ pnpm run build\nDone in 4.2s",
  ...over,
});

const stateOf = (...entries: readonly (readonly [string, SeenPull])[]): SupervisionState => ({
  pulls: new Map(entries),
});

const run = (input: Partial<SupervisionInput> = {}, on: TargetTable = table()): Supervision =>
  supervisePulls(on, { pulls: [pull()], panes: [], state: EMPTY_STATE, ...input });

const only = (supervision: Supervision): SupervisionVerdict => {
  const verdict = supervision.verdicts[0];
  if (verdict === undefined) throw new Error("expected one verdict");
  return verdict;
};

const reasons = (problems: readonly { reason: SupervisionRefusal }[]): readonly SupervisionRefusal[] =>
  problems.map((problem) => problem.reason);

const KEY = pullKey("rickylabs/harness", 169);

describe("what counts as something to say", () => {
  it("says nothing about a pull with no reviews, no failing checks and no conflict", () => {
    const verdict = only(run());
    assert.equal(verdict.reason, "quiet");
    assert.equal(verdict.deliver, false);
    assert.deepEqual(verdict.steering, []);
  });

  it("forwards a review that asked for changes", () => {
    const verdict = only(run({ pulls: [pull({ reviews: [review()] })] }));
    assert.equal(verdict.reason, "steering");
    assert.equal(verdict.deliver, true);
    assert.equal(verdict.steering.length, 1);
    assert.equal(verdict.steering[0]?.signal, "review");
    assert.match(verdict.steering[0]?.line ?? "", /@kmiller \(CHANGES_REQUESTED\).*the ledger reads oddly/);
    assert.deepEqual(verdict.seen.reviews, ["r1"]);
  });

  it("forwards a plain comment review, because a comment is still a request for a turn", () => {
    assert.equal(only(run({ pulls: [pull({ reviews: [review({ state: "commented" })] })] })).reason, "steering");
  });

  it("says nothing about an approval, a dismissal or a pending review", () => {
    // An approval is good news with no request in it, and the human merges either way. Forwarding it
    // asks the agent to respond to a message that is not addressed to it.
    for (const state of ["APPROVED", "DISMISSED", "PENDING"]) {
      assert.equal(only(run({ pulls: [pull({ reviews: [review({ state })] })] })).reason, "quiet", state);
    }
  });

  it("says nothing about a review the bot wrote on the bot's own pull", () => {
    const verdict = only(run({ pulls: [pull({ reviews: [review({ author: "divybot" })] })] }));
    assert.equal(verdict.reason, "quiet");
  });

  it("still forwards a review when no bot login is configured, because nothing is the bot then", () => {
    const verdict = only(run({ pulls: [pull({ reviews: [review({ author: "" })] })] }, table({ botLogin: "" })));
    assert.equal(verdict.reason, "steering");
    assert.match(verdict.steering[0]?.line ?? "", /@\(deleted\)/);
  });

  it("forwards a failing check with its url", () => {
    const verdict = only(run({ pulls: [pull({ checks: [check()] })] }));
    assert.equal(verdict.steering[0]?.signal, "check");
    assert.match(verdict.steering[0]?.line ?? "", /check failed: build \(failure\) — https/);
    assert.deepEqual(verdict.seen.checks, ["c1"]);
  });

  it("treats every failing conclusion as a failure", () => {
    for (const conclusion of ["failure", "TIMED_OUT", "action_required", "startup_failure"]) {
      assert.equal(only(run({ pulls: [pull({ checks: [check({ conclusion })] })] })).reason, "steering", conclusion);
    }
  });

  it("does not treat a cancelled check as a failure", () => {
    // The named divergence. Nearly every cancelled run on an agent's PR was superseded by that
    // agent's own next push, and steering it to fix a run its next commit killed spends the turn.
    for (const conclusion of ["cancelled", "success", "neutral", "skipped", ""]) {
      assert.equal(only(run({ pulls: [pull({ checks: [check({ conclusion })] })] })).reason, "quiet", conclusion);
    }
  });

  it("forwards a merge conflict, named by the head it is against", () => {
    const verdict = only(run({ pulls: [pull({ mergeable: "CONFLICTING" })] }));
    assert.equal(verdict.conflict, "new");
    assert.equal(verdict.steering[0]?.signal, "conflict");
    assert.match(verdict.steering[0]?.line ?? "", /merge conflict at 6a65359/);
    assert.equal(verdict.seen.conflictSha, "6a65359");
  });

  it("does not read an uncomputed mergeable as the absence of a conflict", () => {
    for (const mergeable of ["UNKNOWN", ""]) {
      const verdict = only(run({ pulls: [pull({ mergeable })] }));
      assert.equal(verdict.conflict, "unknown", mergeable);
      assert.deepEqual(verdict.steering, [], mergeable);
    }
  });

  it("orders the notes review, check, conflict — the order they are worth acting on", () => {
    const verdict = only(
      run({ pulls: [pull({ reviews: [review()], checks: [check()], mergeable: "CONFLICTING" })] }),
    );
    assert.deepEqual(
      verdict.steering.map((note) => note.signal),
      ["review", "check", "conflict"],
    );
  });
});

describe("the difference, not the state", () => {
  it("says nothing the second time about a review it forwarded the first time", () => {
    const first = run({ pulls: [pull({ reviews: [review()] })] });
    const next = advanceState(EMPTY_STATE, first);
    const second = only(run({ pulls: [pull({ reviews: [review()] })], state: next }));
    assert.equal(second.reason, "nothing-new");
    assert.deepEqual(second.steering, []);
  });

  it("separates 'nothing new' from 'nothing at all', because they mean different things", () => {
    assert.equal(only(run()).reason, "quiet");
    const told = stateOf([KEY, { reviews: ["r1"], checks: [], conflictSha: "" }]);
    assert.equal(only(run({ pulls: [pull({ reviews: [review()] })], state: told })).reason, "nothing-new");
  });

  it("forwards a re-run that failed again, because a re-run mints a new id", () => {
    const told = stateOf([KEY, { reviews: [], checks: ["c1"], conflictSha: "" }]);
    const verdict = only(run({ pulls: [pull({ checks: [check({ id: "c2" })] })], state: told }));
    assert.equal(verdict.reason, "steering");
    assert.deepEqual(verdict.seen.checks, ["c1", "c2"]);
  });

  it("does not forward the same failed run twice", () => {
    const told = stateOf([KEY, { reviews: [], checks: ["c1"], conflictSha: "" }]);
    assert.equal(only(run({ pulls: [pull({ checks: [check()] })], state: told })).reason, "nothing-new");
  });

  it("forwards a conflict again once the head has moved", () => {
    const told = stateOf([KEY, { reviews: [], checks: [], conflictSha: "older" }]);
    const verdict = only(run({ pulls: [pull({ mergeable: "CONFLICTING" })], state: told }));
    assert.equal(verdict.conflict, "new");
    assert.equal(verdict.reason, "steering");
    assert.equal(verdict.seen.conflictSha, "6a65359");
  });

  it("calls a conflict at an unmoved head restated, and says nothing more about it", () => {
    const told = stateOf([KEY, { reviews: [], checks: [], conflictSha: "6a65359" }]);
    const verdict = only(run({ pulls: [pull({ mergeable: "CONFLICTING" })], state: told }));
    assert.equal(verdict.conflict, "restated");
    assert.equal(verdict.reason, "nothing-new");
  });
});

describe("between turns", () => {
  it("holds every note while the pane says the agent is working", () => {
    const verdict = only(run({ pulls: [pull({ reviews: [review()] })], panes: [pane({ busy: true })] }));
    assert.equal(verdict.reason, "held-mid-turn");
    assert.equal(verdict.deliver, false);
    // Shown, so the operator can see the queue — and not marked, so it comes back.
    assert.equal(verdict.steering.length, 1);
    assert.deepEqual(verdict.seen.reviews, []);
  });

  it("delivers the held note on the next tick, once the pane is idle", () => {
    // The property the whole module turns on: a held note is not lost and not marked.
    const held = run({ pulls: [pull({ reviews: [review()] })], panes: [pane({ busy: true })] });
    const carried = advanceState(EMPTY_STATE, held);
    assert.equal(carried.pulls.size, 0);
    const later = only(run({ pulls: [pull({ reviews: [review()] })], panes: [pane({ busy: false })], state: carried }));
    assert.equal(later.reason, "steering");
    assert.equal(later.steering.length, 1);
  });

  it("does not treat a missing pane read as a busy signal", () => {
    // Holding on silence would mean the command does nothing at all on a fleet with no herdr wired
    // in, and a supervisor whose default is to do nothing is one nobody notices has stopped.
    const verdict = only(run({ pulls: [pull({ reviews: [review()] })], panes: [] }));
    assert.equal(verdict.busy, null);
    assert.equal(verdict.reason, "steering");
  });

  it("reads the pane through the redactor, so no verdict ever carries the token", () => {
    const token = `ghp_${"x".repeat(36)}`;
    const verdict = only(
      run({ pulls: [pull({ reviews: [review()] })], panes: [pane({ busy: true, text: `$ gh auth login ${token}` })] }),
    );
    assert.equal(verdict.transcript.includes(token), false);
    assert.match(verdict.transcript, /ghp_\[redacted\]/);
    assert.deepEqual(verdict.secrets, [{ kind: "github-token", count: 1 }]);
    assert.equal(JSON.stringify(verdict).includes(token), false);
  });
});

describe("what is not supervised", () => {
  it("says nothing about a pull in a repository no row names", () => {
    const verdict = only(run({ pulls: [pull({ repo: "rickylabs/netscript", reviews: [review()] })] }));
    assert.equal(verdict.reason, "untargeted");
    assert.equal(verdict.target, null);
    assert.deepEqual(verdict.steering, []);
  });

  it("does not supervise a row that merges its own pull requests", () => {
    // #75: PRs are merged by humans. A row the dispatcher will squash unattended is not one we
    // queue steering into — and the misconfiguration itself is checkTargets' 'automerge-enabled',
    // reported once, there.
    const verdict = only(
      run(
        { pulls: [pull({ reviews: [review()], checks: [check()], mergeable: "CONFLICTING" })] },
        table({ targets: [target({ automerge: true })] }),
      ),
    );
    assert.equal(verdict.reason, "automerge-on");
    assert.deepEqual(verdict.steering, []);
  });

  it("has no signal that could ever ask for a merge", () => {
    // Three things, notably not four. An approved, green, conflict-free pull is `quiet` — the only
    // thing left to do with it is the human's.
    assert.deepEqual([...PULL_SIGNALS], ["review", "check", "conflict"]);
    assert.equal(only(run({ pulls: [pull({ reviews: [review({ state: "APPROVED" })] })] })).reason, "quiet");
  });

  it("says nothing about a draft, where red CI is the expected reading", () => {
    const verdict = only(run({ pulls: [pull({ draft: true, checks: [check()] })] }));
    assert.equal(verdict.reason, "draft");
  });

  it("still supervises a disabled row, which is what its own doc says it means", () => {
    // `Target.disabled` pauses new spawns: "Live jobs keep running and keep being supervised."
    const verdict = only(
      run({ pulls: [pull({ reviews: [review()] })] }, table({ targets: [target({ disabled: true })] })),
    );
    assert.equal(verdict.reason, "steering");
  });
});

describe("supervisePulls", () => {
  it("takes the first row for a repository, matching resolveTarget", () => {
    const verdict = only(
      run(
        { pulls: [pull({ reviews: [review()] })] },
        table({ targets: [target({ label: "harness", agents: ["codex"] }), target({ label: "second" })] }),
      ),
    );
    assert.equal(verdict.target?.label, "harness");
  });

  it("keeps the first of a duplicated pull and names the rest", () => {
    const supervision = run({ pulls: [pull({ reviews: [review()] }), pull({ reviews: [] })] });
    assert.equal(supervision.verdicts.length, 1);
    assert.equal(only(supervision).reason, "steering");
    assert.deepEqual(supervision.duplicates, [KEY]);
  });

  it("names a repository that supplied pulls and that no row watches", () => {
    const supervision = run({ pulls: [pull({ repo: "rickylabs/netscript" })] });
    assert.deepEqual(supervision.unwatched, ["rickylabs/netscript"]);
  });

  it("names a pane read for a pull the feed does not carry", () => {
    const supervision = run({ panes: [pane({ number: 999 })] });
    assert.deepEqual(supervision.orphanPanes, [pullKey("rickylabs/harness", 999)]);
  });

  it("carries the inbox through, so the output can say which fleet this was", () => {
    assert.equal(run().inbox, "rickylabs/harness");
  });
});

describe("advanceState", () => {
  it("records only what was delivered", () => {
    const supervision = run({
      pulls: [pull({ reviews: [review()] }), pull({ number: 170, reviews: [review({ id: "r2" })] })],
      panes: [pane({ number: 170, busy: true })],
    });
    const next = advanceState(EMPTY_STATE, supervision);
    assert.deepEqual([...next.pulls.keys()], [KEY]);
    assert.deepEqual(next.pulls.get(KEY)?.reviews, ["r1"]);
  });

  it("keeps the marks for a pull this tick's feed did not carry", () => {
    // `gh pr list` returns a window. Dropping a pull's marks because it fell out of one page would
    // re-forward every review on it the moment it came back.
    const before = stateOf([pullKey("rickylabs/harness", 4), { reviews: ["old"], checks: [], conflictSha: "" }]);
    const next = advanceState(before, run({ pulls: [pull({ reviews: [review()] })] }));
    assert.deepEqual(next.pulls.get(pullKey("rickylabs/harness", 4))?.reviews, ["old"]);
    assert.deepEqual(next.pulls.get(KEY)?.reviews, ["r1"]);
  });

  it("does not mutate the state it was given", () => {
    const before = EMPTY_STATE;
    advanceState(before, run({ pulls: [pull({ reviews: [review()] })] }));
    assert.equal(before.pulls.size, 0);
  });
});

describe("tallySupervision", () => {
  it("counts what was said, held and passed over", () => {
    const supervision = run({
      pulls: [
        pull({ reviews: [review()], checks: [check()] }),
        pull({ number: 170, reviews: [review({ id: "r2" })] }),
        pull({ number: 171 }),
        pull({ number: 172, repo: "rickylabs/netscript" }),
        pull({ number: 173, mergeable: "CONFLICTING" }),
      ],
      panes: [pane({ number: 170, busy: true })],
    });
    assert.deepEqual(tallySupervision(supervision), {
      pulls: 5,
      steering: 2,
      notes: 3,
      held: 1,
      quiet: 1,
      untargeted: 1,
      conflicts: 1,
      redactions: 0,
    });
  });

  it("does not count a held note as forwarded, because it was not", () => {
    const supervision = run({ pulls: [pull({ reviews: [review()] })], panes: [pane({ busy: true })] });
    assert.equal(tallySupervision(supervision).notes, 0);
  });

  it("counts every redaction across every pane", () => {
    const token = `ghp_${"x".repeat(36)}`;
    const supervision = run({ pulls: [pull()], panes: [pane({ text: `${token} ${token}` })] });
    assert.equal(tallySupervision(supervision).redactions, 2);
  });
});

describe("checkSupervision", () => {
  it("stays silent on a fleet that is simply up to date", () => {
    const told = stateOf([KEY, { reviews: ["r1"], checks: [], conflictSha: "" }]);
    assert.deepEqual(checkSupervision(run({ pulls: [pull({ reviews: [review()] })], state: told })), []);
    assert.deepEqual(checkSupervision(run()), []);
    assert.deepEqual(checkSupervision(run({ pulls: [pull({ reviews: [review()] })] })), []);
    assert.deepEqual(checkSupervision(run({ pulls: [pull({ reviews: [review()] })], panes: [pane({ busy: true })] })), []);
  });

  it("says a credential reached a terminal, which is the one signal that means rotate", () => {
    const problems = checkSupervision(
      run({ panes: [pane({ text: `$ gh auth login ghp_${"x".repeat(36)}` })] }),
    );
    assert.deepEqual(reasons(problems), ["secret-in-transcript"]);
    assert.match(problems[0]?.message ?? "", /github-token×1.*rotate/);
    assert.equal(problems[0]?.pull, KEY);
  });

  it("says mergeability was assumed rather than observed", () => {
    assert.deepEqual(reasons(checkSupervision(run({ pulls: [pull({ mergeable: "UNKNOWN" })] }))), [
      "mergeable-unknown",
    ]);
  });

  it("says a conflict was forwarded and nothing has been pushed since", () => {
    const told = stateOf([KEY, { reviews: [], checks: [], conflictSha: "6a65359" }]);
    assert.deepEqual(reasons(checkSupervision(run({ pulls: [pull({ mergeable: "CONFLICTING" })], state: told }))), [
      "conflict-not-cleared",
    ]);
  });

  it("says a pull was fetched, decided, and steered nobody", () => {
    assert.deepEqual(reasons(checkSupervision(run({ pulls: [pull({ repo: "rickylabs/netscript" })] }))), [
      "pull-untargeted",
    ]);
  });

  it("says the same pull arrived twice, so a second dump was silently dropped", () => {
    assert.deepEqual(reasons(checkSupervision(run({ pulls: [pull(), pull()] }))), ["duplicate-pull"]);
  });

  it("says a busy signal was read for a pull nothing consulted it about", () => {
    const problems = checkSupervision(run({ panes: [pane({ number: 999, busy: true })] }));
    assert.deepEqual(reasons(problems), ["pane-without-pull"]);
    assert.equal(problems[0]?.pull, pullKey("rickylabs/harness", 999));
  });

  it("reaches every refusal in the closed set", () => {
    const token = `ghp_${"x".repeat(36)}`;
    const told = stateOf([KEY, { reviews: [], checks: [], conflictSha: "6a65359" }]);
    const problems = checkSupervision(
      run({
        pulls: [
          pull({ mergeable: "CONFLICTING" }),
          pull(),
          pull({ number: 170, mergeable: "UNKNOWN" }),
          pull({ number: 171, repo: "rickylabs/netscript" }),
        ],
        panes: [pane({ text: token }), pane({ number: 999 })],
        state: told,
      }),
    );
    assert.deepEqual(new Set(reasons(problems)), new Set(SUPERVISION_REFUSALS));
  });
});

describe("closed sets", () => {
  it("reaches every reason", () => {
    const told = stateOf([pullKey("rickylabs/harness", 174), { reviews: ["r1"], checks: [], conflictSha: "" }]);
    const supervision = supervisePulls(
      table({ targets: [target(), target({ label: "auto", repo: "rickylabs/auto", automerge: true })] }),
      {
        pulls: [
          pull({ reviews: [review()] }), //                                 steering
          pull({ number: 170 }), //                                         quiet
          pull({ number: 171, draft: true, checks: [check()] }), //          draft
          pull({ number: 172, repo: "rickylabs/netscript" }), //             untargeted
          pull({ number: 173, repo: "rickylabs/auto", reviews: [review()] }), // automerge-on
          pull({ number: 174, reviews: [review()] }), //                     nothing-new
          pull({ number: 175, reviews: [review({ id: "r9" })] }), //         held-mid-turn
        ],
        panes: [pane({ number: 175, busy: true })],
        state: told,
      },
    );
    assert.deepEqual(new Set(supervision.verdicts.map((verdict) => verdict.reason)), new Set(SUPERVISION_REASONS));
  });

  it("describes every reason", () => {
    for (const reason of SUPERVISION_REASONS) assert.ok(describeSupervisionReason(reason).length > 0, reason);
  });

  it("leads a problem with the pull when there is one", () => {
    assert.equal(
      describeSupervisionProblem({ reason: "duplicate-pull", message: "twice", pull: KEY }),
      `${KEY}: twice`,
    );
    assert.equal(describeSupervisionProblem({ reason: "duplicate-pull", message: "twice", pull: null }), "twice");
  });
});
