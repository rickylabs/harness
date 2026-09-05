import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRoster, ROSTER_NOTE_CAP } from "./roster.js";

const author = {
  id: "run-author",
  seam: "subscription",
  family: "anthropic",
  model: "opus-5",
  effort: "medium",
};

const candidate = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "run-codex",
  seam: "subscription",
  family: "openai",
  model: "gpt-5.6-sol",
  effort: "xhigh",
  openWeights: false,
  ...over,
});

const roster = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ author, candidates: [candidate()], ...over });

describe("parseRoster", () => {
  it("reads a well-formed roster and says nothing about it", () => {
    const parsed = parseRoster(roster());
    assert.deepEqual(parsed.notes, []);
    assert.equal(parsed.roster?.author.id, "run-author");
    assert.equal(parsed.roster?.candidates.length, 1);
    assert.equal(parsed.roster?.candidates[0]?.openWeights, false);
    assert.equal(parsed.roster?.candidates[0]?.blockedBy, null);
  });

  it("reports unreadable JSON as a note rather than throwing", () => {
    const parsed = parseRoster("{ not json");
    assert.equal(parsed.roster, null);
    assert.match(parsed.notes[0] ?? "", /not JSON/);
  });

  it("requires the envelope, because a bare list does not say whom to be independent of", () => {
    const parsed = parseRoster(JSON.stringify([candidate()]));
    assert.equal(parsed.roster, null);
    assert.match(parsed.notes[0] ?? "", /not a JSON object/);
  });

  it("refuses a roster with no author", () => {
    const parsed = parseRoster(JSON.stringify({ candidates: [candidate()] }));
    assert.equal(parsed.roster, null);
    assert.match(parsed.notes[0] ?? "", /nothing to be independent of/);
  });

  it("names the field that made the author unreadable", () => {
    const parsed = parseRoster(JSON.stringify({ author: { ...author, family: "  " }, candidates: [] }));
    assert.equal(parsed.roster, null);
    assert.equal(parsed.notes[0], "author is unreadable: no family");
  });

  it("names the allowed seams when the seam is not one of them", () => {
    const parsed = parseRoster(JSON.stringify({ author: { ...author, seam: "local" }, candidates: [] }));
    assert.equal(parsed.roster, null);
    assert.match(parsed.notes[0] ?? "", /expected subscription or relay/);
  });

  it("refuses a roster with no candidates array, which is not the same as an empty one", () => {
    assert.equal(parseRoster(JSON.stringify({ author })).roster, null);
    const empty = parseRoster(JSON.stringify({ author, candidates: [] }));
    assert.deepEqual(empty.roster?.candidates, []);
    assert.deepEqual(empty.notes, []);
  });

  it("drops one malformed candidate by index and keeps the rest", () => {
    // A coordinator that refuses the whole file over one bad line has turned a typo into an outage.
    const parsed = parseRoster(
      JSON.stringify({ author, candidates: [candidate({ id: "run-a" }), { id: "run-b" }, candidate({ id: "run-c" })] }),
    );
    assert.deepEqual(parsed.roster?.candidates.map((c) => c.id), ["run-a", "run-c"]);
    assert.equal(parsed.notes[0], "candidate 1 dropped: no seam (expected subscription or relay)");
  });

  it("drops a candidate that does not declare openWeights, rather than guessing", () => {
    // Both guesses are wrong in a way that matters: true lets a closed model review over the public
    // relay, false silently demotes a legal open one.
    const missing = candidate({ id: "run-x" });
    delete missing["openWeights"];
    const parsed = parseRoster(JSON.stringify({ author, candidates: [missing] }));
    assert.deepEqual(parsed.roster?.candidates, []);
    assert.match(parsed.notes[0] ?? "", /openWeights/);
    assert.match(parsed.notes[0] ?? "", /never inferred/);
  });

  it("does not accept a string where openWeights must be a boolean", () => {
    const parsed = parseRoster(JSON.stringify({ author, candidates: [candidate({ openWeights: "true" })] }));
    assert.deepEqual(parsed.roster?.candidates, []);
  });

  it("keeps the first of a duplicated id and says which one it kept", () => {
    const parsed = parseRoster(
      JSON.stringify({ author, candidates: [candidate({ model: "first" }), candidate({ model: "second" })] }),
    );
    assert.equal(parsed.roster?.candidates.length, 1);
    assert.equal(parsed.roster?.candidates[0]?.model, "first");
    assert.match(parsed.notes[0] ?? "", /duplicate id run-codex — the first entry is kept/);
  });

  it("names at most ROSTER_NOTE_CAP bad entries, then counts the rest", () => {
    const broken = Array.from({ length: ROSTER_NOTE_CAP + 3 }, () => ({ nothing: true }));
    const parsed = parseRoster(JSON.stringify({ author, candidates: broken }));
    const named = parsed.notes.filter((n) => n.startsWith("candidate "));
    assert.equal(named.length, ROSTER_NOTE_CAP);
    assert.ok(parsed.notes.includes(`${ROSTER_NOTE_CAP + 3} candidate(s) dropped in total`));
  });

  it("says plainly when nothing at all survived, instead of returning a quiet empty roster", () => {
    // An empty candidate list selects nothing. Silence here would make "blocked: the roster is empty"
    // indistinguishable from "your roster file is malformed".
    const parsed = parseRoster(JSON.stringify({ author, candidates: [{ id: "run-a" }] }));
    assert.ok(parsed.notes.some((n) => n.includes("every candidate was unreadable")));
  });

  it("treats a blank blockedBy as 'not blocked', not as a reason", () => {
    const parsed = parseRoster(JSON.stringify({ author, candidates: [candidate({ blockedBy: "   " })] }));
    assert.equal(parsed.roster?.candidates[0]?.blockedBy, null);
  });

  it("keeps a stated blockedBy verbatim, because it is governance's sentence and not ours", () => {
    const parsed = parseRoster(
      JSON.stringify({ author, candidates: [candidate({ blockedBy: "quota window exhausted until 00:00" })] }),
    );
    assert.equal(parsed.roster?.candidates[0]?.blockedBy, "quota window exhausted until 00:00");
  });

  it("reads a missing effort as an honest null", () => {
    const noEffort = candidate();
    delete noEffort["effort"];
    const parsed = parseRoster(JSON.stringify({ author, candidates: [noEffort] }));
    assert.equal(parsed.roster?.candidates[0]?.effort, null);
  });

  it("trims the fields it reads, so a stray space is not a different family", () => {
    const parsed = parseRoster(JSON.stringify({ author, candidates: [candidate({ family: " openai " })] }));
    assert.equal(parsed.roster?.candidates[0]?.family, "openai");
  });
});
