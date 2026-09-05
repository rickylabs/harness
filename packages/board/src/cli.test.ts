/**
 * The exit-code contract.
 *
 * `dsh-board check` is meant to be run by something that is not a person — a hook, a CI step, a
 * cron. That reader acts on the number, so the number has to mean one thing. `1` says the board
 * contradicts itself; it must never be what comes out when the network was down, when `gh` was
 * missing, or when this program crashed, because each of those means nobody looked at the board at
 * all. These tests exist to keep the codes disjoint, and they run without a network because the
 * whole point is the case the developing machine never sees.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./cli.js";
import type { CliDeps } from "./cli.js";
import { TransportUnavailable } from "./github.js";
import type { FetchResult } from "./github.js";
import type { SourceIssue } from "./model.js";

const AT = "2026-09-05T00:00:00.000Z";

function issue(over: Partial<SourceIssue> & { number: number }): SourceIssue {
  return {
    title: `item ${over.number}`,
    state: "open",
    labels: [],
    url: `https://example.invalid/${over.number}`,
    assignees: [],
    milestone: null,
    createdAt: AT,
    updatedAt: AT,
    kind: "issue",
    ...over,
  };
}

interface Harness {
  readonly deps: CliDeps;
  readonly out: () => string;
  readonly err: () => string;
  readonly fetches: () => number;
}

function harness(over: Partial<CliDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  let fetches = 0;
  const deps: CliDeps = {
    fetchItems: async (): Promise<FetchResult> => {
      fetches += 1;
      return { items: [], completeness: { limit: 500, capped: [] } };
    },
    detectRepoSlug: async () => "o/r",
    cwd: () => "/somewhere",
    now: () => AT,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    ...over,
  };
  // Count fetches even when the caller supplied its own, so "did this command reach the network"
  // is answerable in every test.
  const supplied = over.fetchItems;
  if (supplied !== undefined) {
    deps.fetchItems = async (repo, limit) => {
      fetches += 1;
      return supplied(repo, limit);
    };
  }
  return { deps, out: () => out.join(""), err: () => err.join(""), fetches: () => fetches };
}

const returning = (items: readonly SourceIssue[], capped: FetchResult["completeness"]["capped"] = []) =>
  async (): Promise<FetchResult> => ({ items, completeness: { limit: 500, capped } });

describe("exit 0 — the command answered", () => {
  it("prints the hierarchy by default", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })]) });
    assert.equal(await main([], h.deps), 0);
    assert.match(h.out(), /o\/r/);
  });

  it("accepts an explicit status command", async () => {
    const h = harness();
    assert.equal(await main(["status"], h.deps), 0);
  });

  it("prints columns", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })]) });
    assert.equal(await main(["columns"], h.deps), 0);
    assert.match(h.out(), /## plan \(1\)/);
  });

  it("prints a snapshot that parses as JSON", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })]) });
    assert.equal(await main(["snapshot"], h.deps), 0);
    const parsed: unknown = JSON.parse(h.out());
    assert.equal((parsed as { repo: string }).repo, "o/r");
  });

  it("prints help without reaching the network", async () => {
    const h = harness();
    assert.equal(await main(["--help"], h.deps), 0);
    assert.match(h.out(), /usage:/);
    assert.equal(h.fetches(), 0);
  });

  it("reports a clean board from check", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })]) });
    assert.equal(await main(["check"], h.deps), 0);
    assert.match(h.out(), /no anomalies/);
  });

  it("reports a reachable transport from doctor", async () => {
    const h = harness();
    assert.equal(await main(["doctor"], h.deps), 0);
    assert.match(h.out(), /reachable: yes/);
  });

  it("takes the timestamp from --at, so output is reproducible", async () => {
    const h = harness({ now: () => "clock-was-read" });
    assert.equal(await main(["status", "--at", AT], h.deps), 0);
    assert.ok(!h.out().includes("clock-was-read"));
    assert.match(h.out(), new RegExp(AT));
  });
});

describe("exit 1 — the board contradicts itself, and nothing else", () => {
  it("is what check returns for an anomalous board", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: [] })]) });
    assert.equal(await main(["check"], h.deps), 1);
    assert.match(h.out(), /no-status/);
  });

  it("is not what the reporting commands return for the same board", async () => {
    // `status` describes the board; it does not pass judgement on it. Only `check` is a gate.
    const anomalous = returning([issue({ number: 1, labels: [] })]);
    for (const command of ["status", "columns", "snapshot"]) {
      assert.equal(await main([command], harness({ fetchItems: anomalous }).deps), 0, command);
    }
  });
});

describe("exit 2 — the command line was wrong", () => {
  it("rejects an unknown option before doing any work", async () => {
    const h = harness();
    assert.equal(await main(["status", "--nope"], h.deps), 2);
    assert.match(h.err(), /unknown option --nope/);
    assert.equal(h.fetches(), 0);
  });

  it("rejects an unknown command before reaching the network", async () => {
    // Ordering matters: a typo must not cost a round trip, and must not be reported as a network
    // failure if the network happens to also be down.
    const h = harness();
    assert.equal(await main(["staus"], h.deps), 2);
    assert.match(h.err(), /unknown command "staus"/);
    assert.equal(h.fetches(), 0);
  });

  it("rejects an option with no value", async () => {
    const h = harness();
    assert.equal(await main(["status", "--repo"], h.deps), 2);
    assert.match(h.err(), /--repo requires a value/);
  });

  it("rejects a --limit that is not a positive integer", async () => {
    for (const bad of ["-1", "all", "1.5", ""]) {
      const h = harness();
      assert.equal(await main(["status", "--limit", bad], h.deps), 2, bad);
    }
  });

  it("prints usage alongside the complaint", async () => {
    const h = harness();
    await main(["status", "--nope"], h.deps);
    assert.match(h.err(), /usage:/);
  });
});

describe("exit 3 — nobody could look at the board", () => {
  it("is what a failed repository detection returns", async () => {
    const h = harness({ detectRepoSlug: async () => null });
    assert.equal(await main(["status"], h.deps), 3);
    assert.match(h.err(), /could not determine the repository/);
    assert.equal(h.fetches(), 0);
  });

  it("is what an unavailable transport returns, for every command", async () => {
    for (const command of ["status", "columns", "snapshot", "check"]) {
      const h = harness({
        fetchItems: async () => {
          throw new TransportUnavailable("gh is not installed or not on PATH");
        },
      });
      assert.equal(await main([command], h.deps), 3, command);
      assert.match(h.err(), /gh auth login/);
    }
  });

  it("is what doctor returns when gh cannot reach GitHub", async () => {
    const h = harness({
      fetchItems: async () => {
        throw new TransportUnavailable("HTTP 502: Bad gateway");
      },
    });
    assert.equal(await main(["doctor"], h.deps), 3);
    assert.match(h.out(), /reachable: no/);
    assert.match(h.out(), /502/);
  });

  it("does not need detection when --repo was given", async () => {
    const h = harness({
      detectRepoSlug: async () => {
        throw new Error("detection must not be attempted");
      },
    });
    assert.equal(await main(["status", "--repo", "other/repo"], h.deps), 0);
    assert.match(h.out(), /other\/repo/);
  });
});

describe("exit 4 — the program itself failed", () => {
  it("does not swallow an unexpected error into a board verdict", async () => {
    // The rejection reaches the top-level handler, which sets 4. What must never happen is this
    // returning 1: a crash is not evidence that the board contradicts itself.
    const boom = new Error("a defect, not a network problem");
    const h = harness({
      fetchItems: async () => {
        throw boom;
      },
    });
    await assert.rejects(() => main(["check"], h.deps), boom);
  });
});

describe("the incompleteness banner", () => {
  it("goes to stderr, so it survives a pipe into a file nobody reads the top of", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })], ["issue"]) });
    assert.equal(await main(["status"], h.deps), 0);
    assert.match(h.err(), /INCOMPLETE/);
  });

  it("also goes above the human-readable output", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })], ["issue"]) });
    await main(["status"], h.deps);
    assert.ok(h.out().startsWith("!! INCOMPLETE"), h.out().slice(0, 40));
  });

  it("stays out of the snapshot, which has to remain parseable JSON", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })], ["issue"]) });
    await main(["snapshot"], h.deps);
    const parsed = JSON.parse(h.out()) as { completeness: unknown };
    assert.deepEqual(parsed.completeness, { limit: 500, capped: ["issue"] });
    assert.match(h.err(), /INCOMPLETE/);
  });

  it("is absent when the fetch was complete", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })]) });
    await main(["status"], h.deps);
    assert.ok(!h.out().includes("INCOMPLETE"));
    assert.ok(!h.err().includes("INCOMPLETE"));
  });

  it("makes check fail on a truncated board, which is not a board it can clear", async () => {
    const h = harness({ fetchItems: returning([issue({ number: 1, labels: ["status:plan"] })], ["issue"]) });
    assert.equal(await main(["check"], h.deps), 1);
    assert.match(h.out(), /incomplete-fetch/);
  });
});

describe("options reach the projection", () => {
  it("passes --limit through to the fetch", async () => {
    let seen = -1;
    const h = harness({
      fetchItems: async (_repo, limit) => {
        seen = limit;
        return { items: [], completeness: { limit, capped: [] } };
      },
    });
    await main(["status", "--limit", "7"], h.deps);
    assert.equal(seen, 7);
  });

  it("passes --lane-prefix through to the projection", async () => {
    const h = harness({
      fetchItems: returning([issue({ number: 1, labels: ["status:plan", "orchestrator:arch"] })]),
    });
    await main(["snapshot", "--lane-prefix", "orchestrator"], h.deps);
    const parsed = JSON.parse(h.out()) as { items: { lane: string | null }[] };
    assert.equal(parsed.items[0]?.lane, "arch");
  });

  it("passes --repo through to the fetch", async () => {
    let seen = "";
    const h = harness({
      fetchItems: async (repo) => {
        seen = repo;
        return { items: [], completeness: { limit: 500, capped: [] } };
      },
    });
    await main(["status", "--repo", "rickylabs/harness"], h.deps);
    assert.equal(seen, "rickylabs/harness");
  });
});
