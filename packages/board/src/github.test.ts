import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectRepoSlug, fetchItems, transportFailure, TransportUnavailable } from "./github.js";
import type { GhRunner } from "./github.js";

/** A runner that answers `issue list` and `pr list` from fixed payloads. */
const runnerFor = (issues: unknown, prs: unknown): GhRunner => {
  return async (args) => {
    if (args[0] === "issue") return JSON.stringify(issues);
    if (args[0] === "pr") return JSON.stringify(prs);
    throw new Error(`unexpected gh invocation: ${args.join(" ")}`);
  };
};

const ghIssue = (over: Record<string, unknown> & { number: number }) => ({
  title: `item ${over.number}`,
  state: "OPEN",
  url: `https://github.invalid/o/r/issues/${over.number}`,
  createdAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
  ...over,
});

describe("transportFailure", () => {
  it("recognises a missing binary", () => {
    assert.match(transportFailure(new Error("spawn gh ENOENT")).message, /not installed/);
  });

  it("recognises an authentication failure", () => {
    assert.match(transportFailure(new Error("HTTP 401: Bad credentials")).message, /not authenticated/);
  });

  it("classifies everything else as transport rather than letting it escape", () => {
    // This is the defect: a rate limit, a DNS failure, a proxy, a repository that does not exist
    // — none of them say anything about the board, and all of them used to reach the CLI as an
    // unclassified throw, which surfaced as the exit code reserved for board anomalies.
    for (const error of [
      new Error("HTTP 502: Bad gateway"),
      new Error("getaddrinfo EAI_AGAIN api.github.com"),
      new Error("API rate limit exceeded"),
      new Error("GraphQL: Could not resolve to a Repository"),
      new Error(""),
      "a string, not an Error",
      undefined,
      null,
      { message: "not an Error either" },
    ]) {
      const failure = transportFailure(error);
      assert.ok(failure instanceof TransportUnavailable, `unclassified: ${String(error)}`);
      assert.ok(failure.message.length > 0);
    }
  });

  it("keeps the underlying message rather than swallowing it", () => {
    assert.match(transportFailure(new Error("HTTP 502: Bad gateway")).message, /502/);
  });
});

describe("fetchItems", () => {
  it("passes the repository as an argument, never as shell text", async () => {
    // `execFile` with an argv array is what makes a repository slug inert. Pinning the argv here
    // is what keeps a future refactor from reintroducing a shell.
    const seen: (readonly string[])[] = [];
    const runner: GhRunner = async (args) => {
      seen.push(args);
      return "[]";
    };
    await fetchItems("o/r; rm -rf /", 500, runner);
    for (const args of seen) {
      assert.ok(args.includes("o/r; rm -rf /"), "the slug must travel as one argv entry");
      assert.ok(args.includes("--repo"));
    }
  });

  it("asks for both states, so closed work is on the board too", async () => {
    const seen: (readonly string[])[] = [];
    await fetchItems("o/r", 500, async (args) => {
      seen.push(args);
      return "[]";
    });
    for (const args of seen) assert.equal(args[args.indexOf("--state") + 1], "all");
  });

  it("normalises an issue into the projection's own shape", async () => {
    const { items } = await fetchItems(
      "o/r",
      500,
      runnerFor(
        [
          ghIssue({
            number: 36,
            title: "E6 — Coordinator",
            labels: [{ name: "epic" }, { name: "status:in-progress" }],
            assignees: [{ login: "someone" }],
            milestone: { title: "W1" },
          }),
        ],
        [],
      ),
    );
    assert.deepEqual(items[0], {
      number: 36,
      title: "E6 — Coordinator",
      state: "open",
      labels: ["epic", "status:in-progress"],
      url: "https://github.invalid/o/r/issues/36",
      assignees: ["someone"],
      milestone: "W1",
      createdAt: "2026-09-05T00:00:00Z",
      updatedAt: "2026-09-05T00:00:00Z",
      kind: "issue",
    });
  });

  it("reads merged from mergedAt, which is the only place it exists", async () => {
    const { items } = await fetchItems(
      "o/r",
      500,
      runnerFor(
        [],
        [
          ghIssue({ number: 1, state: "CLOSED", mergedAt: "2026-09-01T12:00:00Z" }),
          ghIssue({ number: 2, state: "CLOSED", mergedAt: null }),
          ghIssue({ number: 3, state: "OPEN", isDraft: true }),
        ],
      ),
    );
    assert.equal(items[0]?.merged, true);
    assert.equal(items[1]?.merged, false, "a closed PR with no mergedAt did not land");
    assert.equal(items[2]?.draft, true);
    assert.ok(items.every((i) => i.kind === "pull-request"));
  });

  it("does not put a merged flag on issues, which cannot merge", async () => {
    const { items } = await fetchItems("o/r", 500, runnerFor([ghIssue({ number: 1 })], []));
    assert.ok(!("merged" in (items[0] ?? {})));
  });

  it("reports a fetch that came back under the limit as complete", async () => {
    const result = await fetchItems("o/r", 10, runnerFor([ghIssue({ number: 1 })], []));
    assert.deepEqual(result.completeness, { limit: 10, capped: [] });
  });

  it("reports a kind that came back exactly at the limit as capped", async () => {
    const result = await fetchItems(
      "o/r",
      2,
      runnerFor([ghIssue({ number: 1 }), ghIssue({ number: 2 })], [ghIssue({ number: 3 })]),
    );
    assert.deepEqual(result.completeness, { limit: 2, capped: ["issue"] });
  });

  it("reports both kinds when both filled the limit", async () => {
    const result = await fetchItems("o/r", 1, runnerFor([ghIssue({ number: 1 })], [ghIssue({ number: 2 })]));
    assert.deepEqual(result.completeness.capped, ["issue", "pull-request"]);
  });

  it("treats output that is not JSON as a transport failure", async () => {
    // A proxy error page, a login banner, an empty stdout — all of them mean nobody read the
    // board, which is not the same as the board being wrong.
    await assert.rejects(
      () => fetchItems("o/r", 500, async () => "<html>Access denied</html>"),
      TransportUnavailable,
    );
  });

  it("treats a non-array payload as a transport failure", async () => {
    await assert.rejects(() => fetchItems("o/r", 500, async () => '{"message":"Not Found"}'), TransportUnavailable);
  });

  it("names the kind whose payload was unusable", async () => {
    await assert.rejects(
      () => fetchItems("o/r", 500, async (args) => (args[0] === "pr" ? "nonsense" : "[]")),
      /pull-requests/,
    );
  });
});

describe("detectRepoSlug", () => {
  it("returns the trimmed slug", async () => {
    assert.equal(await detectRepoSlug("/somewhere", async () => "rickylabs/harness\n"), "rickylabs/harness");
  });

  it("returns null rather than throwing when gh cannot answer", async () => {
    // Detection failing is not an error: the caller has --repo. The CLI turns a null into advice.
    assert.equal(
      await detectRepoSlug("/somewhere", async () => {
        throw new TransportUnavailable("not a git repository");
      }),
      null,
    );
  });

  it("returns null for empty output", async () => {
    assert.equal(await detectRepoSlug("/somewhere", async () => "  \n"), null);
  });

  it("runs in the directory it was asked about", async () => {
    let seen: string | undefined;
    await detectRepoSlug("/somewhere", async (_args, cwd) => {
      seen = cwd;
      return "o/r";
    });
    assert.equal(seen, "/somewhere");
  });
});
