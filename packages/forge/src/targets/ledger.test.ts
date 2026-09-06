import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_LEDGER } from "./handover.js";
import { describeLedgerIssue, loadHandoverLedger, parseHandoverLedger } from "./ledger.js";

const paths = (issues: readonly { path: string }[]): readonly string[] => issues.map((issue) => issue.path);

const missing = (code: string): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(code);
  error.code = code;
  return error;
};

describe("parseHandoverLedger", () => {
  it("reads a whole ledger", () => {
    const { ledger, issues } = parseHandoverLedger(
      JSON.stringify({
        parity: [
          {
            account: "claude",
            provider: "n5air",
            provenAt: "2026-09-06",
            evidence: "rickylabs/harness#76",
            note: "same prompt, same diff",
          },
        ],
        pins: [{ label: "harness", backend: "divybot", reason: "spawned twice on #164" }],
      }),
    );
    assert.deepEqual(issues, []);
    assert.equal(ledger.parity[0]?.account, "claude");
    assert.equal(ledger.parity[0]?.note, "same prompt, same diff");
    assert.equal(ledger.pins[0]?.backend, "divybot");
  });

  it("treats every absent field as empty rather than as an error", () => {
    // Emptiness is `checkHandover`'s business, not the parser's: a record with no evidence parses
    // fine and is refused one layer up, where the refusal can say why it matters.
    const { ledger, issues } = parseHandoverLedger(JSON.stringify({ parity: [{ account: "claude" }] }));
    assert.deepEqual(issues, []);
    assert.deepEqual(ledger.parity[0], {
      account: "claude",
      provider: "",
      provenAt: "",
      evidence: "",
      note: "",
    });
  });

  it("names an unknown key at the top level", () => {
    const { issues } = parseHandoverLedger(JSON.stringify({ parity: [], pins: [], parties: [] }));
    assert.deepEqual(paths(issues), ["parties"]);
  });

  it("names an unknown key inside a record, which is the typo that matters", () => {
    // `evidance:` would otherwise surface only as `checkHandover` saying "records no evidence" —
    // true, and three minutes from the actual mistake.
    const { issues } = parseHandoverLedger(
      JSON.stringify({ parity: [{ account: "claude", evidance: "rickylabs/harness#76" }] }),
    );
    assert.deepEqual(paths(issues), ["parity[0].evidance"]);
  });

  it("names an unknown key inside a pin", () => {
    const { issues } = parseHandoverLedger(JSON.stringify({ pins: [{ label: "harness", backend: "divybot", why: "x" }] }));
    assert.deepEqual(paths(issues), ["pins[0].why"]);
  });

  it("names a field that arrived as the wrong type, and keeps the rest of the record", () => {
    const { ledger, issues } = parseHandoverLedger(
      JSON.stringify({ parity: [{ account: "claude", evidence: ["rickylabs/harness#76"] }] }),
    );
    assert.deepEqual(paths(issues), ["parity[0].evidence"]);
    assert.match(issues[0]?.message ?? "", /found a list/);
    assert.equal(ledger.parity[0]?.account, "claude");
    assert.equal(ledger.parity[0]?.evidence, "");
  });

  it("skips a non-object element and keeps its neighbours", () => {
    const { ledger, issues } = parseHandoverLedger(
      JSON.stringify({ parity: ["claude", { account: "codex" }] }),
    );
    assert.deepEqual(paths(issues), ["parity[0]"]);
    assert.equal(ledger.parity.length, 1);
    assert.equal(ledger.parity[0]?.account, "codex");
  });

  it("names a list that is not a list", () => {
    const { ledger, issues } = parseHandoverLedger(JSON.stringify({ pins: { harness: "divybot" } }));
    assert.deepEqual(paths(issues), ["pins"]);
    assert.deepEqual(ledger.pins, []);
  });

  it("refuses text that is not JSON, without a stack trace", () => {
    const { ledger, issues } = parseHandoverLedger("{ parity: [] }");
    assert.equal(ledger, EMPTY_LEDGER);
    assert.equal(issues.length, 1);
    assert.match(issues[0]?.message ?? "", /^not valid JSON: /);
  });

  it("refuses a document that is not an object", () => {
    for (const text of ["[]", "null", '"handover"', "7"]) {
      const { ledger, issues } = parseHandoverLedger(text);
      assert.equal(ledger, EMPTY_LEDGER, text);
      assert.equal(issues.length, 1, text);
      assert.match(issues[0]?.message ?? "", /^expected a JSON object at the top level/);
    }
  });
});

describe("every backend fallback lands on divybot", () => {
  // The direction of the fallbacks is the point, not the fact that there are any. Dropping a
  // malformed pin would leave its target on whatever parity decided — which for a proven vendor is
  // the provider path — so a typo in a claw-back would silently fail to claw anything back.
  for (const [name, backend] of [
    ["absent", undefined],
    ["null", null],
    ["the wrong type", 7],
    ["a backend that does not exist", "herdr"],
    ["a near miss", "Provider"],
  ] as const) {
    it(`reads ${name} as divybot, and says so`, () => {
      const document: Record<string, unknown> = { label: "harness", reason: "x" };
      if (backend !== undefined) document["backend"] = backend;
      const { ledger, issues } = parseHandoverLedger(JSON.stringify({ pins: [document] }));
      assert.equal(ledger.pins[0]?.backend, "divybot");
      assert.deepEqual(paths(issues), ["pins[0].backend"]);
      assert.match(issues[0]?.message ?? "", /divybot/);
    });
  }
});

describe("loadHandoverLedger", () => {
  it("reads a file that is there", () => {
    const loaded = loadHandoverLedger("/repo/handover.json", () => JSON.stringify({ parity: [{ account: "agy" }] }));
    assert.equal(loaded.found, true);
    assert.equal(loaded.path, "/repo/handover.json");
    assert.equal(loaded.ledger.parity[0]?.account, "agy");
  });

  it("treats a missing file as today's answer rather than as a fault", () => {
    // The strongest statement the module makes: a repository with no ledger is a repository where
    // every target is dispatched by divybot, which is both the documented default and the state the
    // fleet is in. Nothing has to be written for the current behaviour to be describable.
    for (const code of ["ENOENT", "ENOTDIR"]) {
      const loaded = loadHandoverLedger("/repo/handover.json", () => {
        throw missing(code);
      });
      assert.equal(loaded.found, false, code);
      assert.equal(loaded.ledger, EMPTY_LEDGER, code);
      assert.deepEqual(loaded.issues, [], code);
    }
  });

  it("re-throws anything else, because an unreadable file is not an empty one", () => {
    assert.throws(
      () =>
        loadHandoverLedger("/repo/handover.json", () => {
          throw missing("EACCES");
        }),
      /EACCES/,
    );
  });

  it("reports a bad file rather than pretending it was absent", () => {
    const loaded = loadHandoverLedger("/repo/handover.json", () => "nope");
    assert.equal(loaded.found, true);
    assert.equal(loaded.issues.length, 1);
  });
});

describe("describeLedgerIssue", () => {
  it("leads with the path when there is one", () => {
    assert.equal(describeLedgerIssue({ path: "pins[0].backend", message: "m" }), "pins[0].backend: m");
    assert.equal(describeLedgerIssue({ path: "", message: "m" }), "m");
  });
});
