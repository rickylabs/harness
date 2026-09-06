import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_STATE, advanceState, pullKey, supervisePulls } from "./steer.js";
import type { SeenPull, SupervisionState } from "./steer.js";
import {
  SUPERVISION_FILE,
  describeStateIssue,
  loadSupervisionState,
  parseSupervisionState,
  serializeSupervisionState,
  supervisionStateDocument,
} from "./state.js";

const paths = (issues: readonly { path: string }[]): readonly string[] => issues.map((issue) => issue.path);

const missing = (code: string): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(code);
  error.code = code;
  return error;
};

const KEY = pullKey("rickylabs/harness", 169);

const seen = (over: Partial<SeenPull> = {}): SeenPull => ({
  reviews: [],
  checks: [],
  conflictSha: "",
  ...over,
});

const stateOf = (...entries: readonly (readonly [string, SeenPull])[]): SupervisionState => ({
  pulls: new Map(entries),
});

describe("parseSupervisionState", () => {
  it("reads a whole file", () => {
    const { state, issues } = parseSupervisionState(
      JSON.stringify({
        pulls: {
          "rickylabs/harness#169": { reviews: ["r1", "r2"], checks: ["c9"], conflictSha: "6a65359" },
          "rickylabs/netscript#4": { reviews: [], checks: [], conflictSha: "" },
        },
      }),
    );
    assert.deepEqual(issues, []);
    assert.equal(state.pulls.size, 2);
    assert.deepEqual(state.pulls.get(KEY), { reviews: ["r1", "r2"], checks: ["c9"], conflictSha: "6a65359" });
  });

  it("reads an empty document as an empty state", () => {
    for (const text of ["{}", '{"pulls":{}}', '{"pulls":null}']) {
      const { state, issues } = parseSupervisionState(text);
      assert.equal(state.pulls.size, 0, text);
      assert.deepEqual(issues, [], text);
    }
  });

  it("reads an absent field as nothing recorded, which re-forwards rather than swallows", () => {
    const { state, issues } = parseSupervisionState('{"pulls":{"rickylabs/harness#169":{}}}');
    assert.deepEqual(issues, []);
    assert.deepEqual(state.pulls.get(KEY), { reviews: [], checks: [], conflictSha: "" });
  });

  it("names a key nothing reads, at either level", () => {
    const { issues } = parseSupervisionState(
      JSON.stringify({ pulls: { "rickylabs/harness#169": { conflictSHA: "6a65359" } }, version: 2 }),
    );
    assert.deepEqual(paths(issues), ["version", "pulls[rickylabs/harness#169].conflictSHA"]);
    assert.match(issues[0]?.message ?? "", /nothing reads it/);
  });

  it("keeps reading after a typo, because the rest of the file is still the record", () => {
    // A `conflictSHA:` that parses as nothing surfaces as a conflict forwarded on every tick — true,
    // and a long way from the typo that caused it. So it is named here, where it is fixable.
    const { state } = parseSupervisionState(
      JSON.stringify({ pulls: { "rickylabs/harness#169": { conflictSHA: "6a65359", reviews: ["r1"] } } }),
    );
    assert.deepEqual(state.pulls.get(KEY), { reviews: ["r1"], checks: [], conflictSha: "" });
  });

  it("names a field of the wrong shape and reads it as nothing recorded", () => {
    const { state, issues } = parseSupervisionState(
      JSON.stringify({ pulls: { "rickylabs/harness#169": { reviews: "r1", checks: {}, conflictSha: 4 } } }),
    );
    assert.deepEqual(paths(issues), [
      "pulls[rickylabs/harness#169].reviews",
      "pulls[rickylabs/harness#169].checks",
      "pulls[rickylabs/harness#169].conflictSha",
    ]);
    assert.match(issues[0]?.message ?? "", /expected a list, found string — reading it as nothing recorded/);
    assert.deepEqual(state.pulls.get(KEY), { reviews: [], checks: [], conflictSha: "" });
  });

  it("drops an element that is not an id and names its index", () => {
    const { state, issues } = parseSupervisionState(
      JSON.stringify({ pulls: { "rickylabs/harness#169": { reviews: ["r1", 7, null, "r2"] } } }),
    );
    assert.deepEqual(paths(issues), [
      "pulls[rickylabs/harness#169].reviews[1]",
      "pulls[rickylabs/harness#169].reviews[2]",
    ]);
    assert.deepEqual(state.pulls.get(KEY)?.reviews, ["r1", "r2"]);
  });

  it("drops an entry that is not an object and says the pull will re-forward", () => {
    const { state, issues } = parseSupervisionState(
      JSON.stringify({ pulls: { "rickylabs/harness#169": ["r1"], "rickylabs/harness#170": { reviews: ["r2"] } } }),
    );
    assert.deepEqual(paths(issues), ["pulls[rickylabs/harness#169]"]);
    assert.match(issues[0]?.message ?? "", /found a list.*re-forwards/);
    assert.equal(state.pulls.has(KEY), false);
    assert.deepEqual(state.pulls.get(pullKey("rickylabs/harness", 170))?.reviews, ["r2"]);
  });

  it("names a pulls field that is not an object at all", () => {
    const { state, issues } = parseSupervisionState('{"pulls":[]}');
    assert.deepEqual(paths(issues), ["pulls"]);
    assert.match(issues[0]?.message ?? "", /keyed by 'owner\/name#123'/);
    assert.equal(state.pulls.size, 0);
  });

  it("names a document that is not JSON, and does not throw", () => {
    const { state, issues } = parseSupervisionState("{ pulls: }");
    assert.deepEqual(paths(issues), [""]);
    assert.match(issues[0]?.message ?? "", /not valid JSON/);
    assert.equal(state.pulls.size, 0);
  });

  it("names a document that is not an object", () => {
    for (const { text, shape } of [
      { text: "[]", shape: "found a list" },
      { text: "null", shape: "found null" },
      { text: '"pulls"', shape: "found string" },
      { text: "4", shape: "found number" },
    ]) {
      const { state, issues } = parseSupervisionState(text);
      assert.deepEqual(paths(issues), [""], text);
      assert.match(issues[0]?.message ?? "", new RegExp(shape), text);
      assert.equal(state.pulls.size, 0, text);
    }
  });
});

describe("loadSupervisionState", () => {
  it("reads the file when it is there", () => {
    const loaded = loadSupervisionState("/x/supervision.json", () =>
      JSON.stringify({ pulls: { "rickylabs/harness#169": { reviews: ["r1"] } } }),
    );
    assert.equal(loaded.found, true);
    assert.equal(loaded.path, "/x/supervision.json");
    assert.deepEqual(loaded.state.pulls.get(KEY)?.reviews, ["r1"]);
  });

  it("treats an absent file as a first tick, not a fault", () => {
    // The whole command is usable before anyone has written a file: everything open counts as new,
    // which is exactly right, because the agent has not been told any of it.
    for (const code of ["ENOENT", "ENOTDIR"]) {
      const loaded = loadSupervisionState("/x/supervision.json", () => {
        throw missing(code);
      });
      assert.equal(loaded.found, false, code);
      assert.equal(loaded.state.pulls.size, 0, code);
      assert.deepEqual(loaded.issues, [], code);
    }
  });

  it("re-throws anything else, because an unreadable file is not an empty one", () => {
    // Silently re-forwarding a fleet's whole review backlog because a mode bit was wrong is not a
    // recovery, and the operator would have no way to tell it happened.
    assert.throws(
      () =>
        loadSupervisionState("/x/supervision.json", () => {
          throw missing("EACCES");
        }),
      /EACCES/,
    );
  });

  it("carries a bad file's issues rather than throwing over them", () => {
    const loaded = loadSupervisionState("/x/supervision.json", () => "nope");
    assert.equal(loaded.found, true);
    assert.equal(loaded.issues.length, 1);
    assert.equal(loaded.state.pulls.size, 0);
  });

  it("names the file it looks for", () => {
    assert.equal(SUPERVISION_FILE, "supervision.json");
  });
});

describe("supervisionStateDocument", () => {
  it("sorts the keys, so two ticks that delivered the same things write the same bytes", () => {
    const document = supervisionStateDocument(
      stateOf(
        ["rickylabs/harness#9", seen({ reviews: ["r9"] })],
        ["rickylabs/harness#169", seen({ checks: ["c1"] })],
        ["rickylabs/netscript#4", seen({ conflictSha: "abc" })],
      ),
    );
    assert.deepEqual(Object.keys(document.pulls), [
      "rickylabs/harness#169",
      "rickylabs/harness#9",
      "rickylabs/netscript#4",
    ]);
  });

  it("is a plain object, so JSON.stringify does not silently drop the Map", () => {
    const document = supervisionStateDocument(stateOf([KEY, seen({ reviews: ["r1"] })]));
    assert.deepEqual(document, { pulls: { "rickylabs/harness#169": { reviews: ["r1"], checks: [], conflictSha: "" } } });
  });

  it("writes an empty state as an empty document rather than nothing", () => {
    assert.deepEqual(supervisionStateDocument(EMPTY_STATE), { pulls: {} });
  });
});

describe("serializeSupervisionState", () => {
  it("writes the same document supervisionStateDocument returns", () => {
    // `--json` carries the document and the writer writes the bytes; if these two could differ, the
    // preview an operator reads would not be the file the next tick reads back.
    const state = stateOf([KEY, seen({ reviews: ["r1"], conflictSha: "6a65359" })]);
    assert.deepEqual(JSON.parse(serializeSupervisionState(state)), supervisionStateDocument(state));
  });

  it("ends with a newline and is stable across two renderings of the same content", () => {
    const one = stateOf([KEY, seen({ reviews: ["r1"] })], ["rickylabs/netscript#4", seen()]);
    const other = stateOf(["rickylabs/netscript#4", seen()], [KEY, seen({ reviews: ["r1"] })]);
    assert.match(serializeSupervisionState(one), /\n$/);
    assert.equal(serializeSupervisionState(one), serializeSupervisionState(other));
  });

  it("round-trips a tick: what was delivered comes back as already told", () => {
    const table = {
      inbox: "rickylabs/harness",
      botLogin: "divybot",
      branchPrefix: "orch/divybot-",
      pollInterval: "30s",
      targets: [
        {
          label: "harness",
          repo: "rickylabs/harness",
          agents: ["claude"],
          automerge: false,
          priority: 0,
          disabled: false,
        },
      ],
      memory: { enabled: false, repo: "rickylabs/harness", branch: "main", dir: "memory", interval: "5m" },
    };
    const feed = {
      pulls: [
        {
          repo: "rickylabs/harness",
          number: 169,
          url: "https://github.com/rickylabs/harness/pull/169",
          headSha: "6a65359",
          mergeable: "MERGEABLE",
          draft: false,
          reviews: [
            { id: "r1", author: "kmiller", state: "CHANGES_REQUESTED", submittedAt: "2026-09-06T10:00:00Z", body: "x" },
          ],
          checks: [],
        },
      ],
      panes: [],
    };

    const first = supervisePulls(table, { ...feed, state: EMPTY_STATE });
    assert.equal(first.verdicts[0]?.reason, "steering");

    const written = serializeSupervisionState(advanceState(EMPTY_STATE, first));
    const read = parseSupervisionState(written);
    assert.deepEqual(read.issues, []);

    const second = supervisePulls(table, { ...feed, state: read.state });
    assert.equal(second.verdicts[0]?.reason, "nothing-new");
  });
});

describe("describeStateIssue", () => {
  it("leads with the path when there is one", () => {
    assert.equal(describeStateIssue({ path: "pulls", message: "expected an object" }), "pulls: expected an object");
    assert.equal(describeStateIssue({ path: "", message: "not valid JSON" }), "not valid JSON");
  });
});
