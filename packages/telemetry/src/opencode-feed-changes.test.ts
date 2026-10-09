/** OpenCode change hints: one event stream, opened only while a session is watched, never retried by itself. */
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { Writable } from "node:stream";
import { it } from "node:test";
import { openOpenCodeChanges } from "./opencode-feed-changes.js";
import { issueAgentFeedCommand } from "./issue-agent-feed-cli.js";

/** A fake `sessionEvents` whose streams the test writes to, ends, or refuses to open. */
function events() {
  const opened: { signal: AbortSignal; push(id: string): void; end(): void }[] = [];
  let refuse = false;
  const reads = {
    async sessionEvents(signal: AbortSignal) {
      if (refuse) return { kind: "closed" as const };
      const queue: string[] = [];
      let wake = () => {}, ended = false;
      const stream = { signal, push(id: string) { queue.push(id); wake(); }, end() { ended = true; wake(); } };
      signal.addEventListener("abort", () => stream.end());
      opened.push(stream);
      return { kind: "open" as const, sessions: (async function* () {
        while (true) {
          if (queue.length > 0) { yield queue.shift()!; continue; }
          if (ended) return;
          await new Promise<void>(resolve => { wake = resolve; });
        }
      })() };
    },
  };
  return { reads, opened, refuse: (value: boolean) => { refuse = value; } };
}
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

it("an event naming a watched session marks the feed dirty once; other sessions do not", async () => {
  const e = events(), changes = openOpenCodeChanges(e.reads);
  changes.watch(new Set(["ses_watched"])); await settle();
  assert.equal(e.opened.length, 1);
  e.opened[0]!.push("ses_other"); await settle();
  assert.equal(changes.consume(), false);
  e.opened[0]!.push("ses_watched"); await settle();
  assert.equal(changes.consume(), true); assert.equal(changes.consume(), false);
  // A rescan that watches the same sessions keeps the one stream.
  changes.watch(new Set(["ses_watched"])); await settle();
  assert.equal(e.opened.length, 1);
  changes.close(); await settle();
  assert.equal(e.opened[0]!.signal.aborted, true);
});

it("no session closes the stream; a refused open is not retried until the next scan; a dropped stream is a hint", async () => {
  const e = events(), changes = openOpenCodeChanges(e.reads);
  changes.watch(new Set()); await settle();
  assert.equal(e.opened.length, 0);
  e.refuse(true); changes.watch(new Set(["ses_a"])); await settle();
  assert.equal(changes.consume(), false, "a stream that never opened says nothing");
  await settle(); assert.equal(e.opened.length, 0, "nothing reconnects in the background");
  e.refuse(false); changes.watch(new Set(["ses_a"])); await settle();
  assert.equal(e.opened.length, 1);
  e.opened[0]!.end(); await settle();
  assert.equal(changes.consume(), true, "events may have been missed while it was down");
  changes.watch(new Set()); changes.close();
});

it("the watch loop hands the scanned sessions to the hint and rescans when it fires", async () => {
  const watched: string[][] = [];
  let collects = 0, fire = false;
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const at = "2026-01-01T00:00:00.000Z";
  const code = await issueAgentFeedCommand(["--watch"], { output, now: () => at, generation: () => "fixture",
    env: {}, elapsed: () => 0,
    collect: async options => {
      collects++; options.watchOpenCodeSessions?.add("ses_fixture");
      return { schema: 1, protocol: 1, observedAt: at, validUntil: "2026-01-01T00:00:15.000Z", revision: "a".repeat(64),
        complete: true, reason: null, issues: [] };
    },
    openCodeChanges: { consume: () => { const changed = fire; fire = false; return changed; },
      watch: sessions => { watched.push([...sessions]); fire = watched.length === 1; }, close: () => {} },
    wait: async () => { if (collects >= 2) output.emit("close"); } });
  assert.equal(code, 0);
  assert.equal(collects, 2, "the hint caused the second scan before the safety rescan");
  assert.deepEqual(watched[0], ["ses_fixture"]);
});
