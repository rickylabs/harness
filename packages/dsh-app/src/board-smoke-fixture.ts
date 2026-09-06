import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { SessionStore } from "@deepseek-ai/dsh-session";
import * as todoPlugin from "@deepseek-ai/dsh-tool-todo";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import type { SourceIssue } from "@rickylabs/board";
import type { RunRecord } from "@rickylabs/telemetry";
import boardPlugin, { CONTEXT_KEY, type BoardRefreshInput } from "./plugins/board.js";

const AT = "2026-09-07T00:00:00.000Z";

function issue(overrides: Partial<SourceIssue> & { readonly number: number }): SourceIssue {
  const { number, ...rest } = overrides;
  return {
    number,
    title: `item ${number}`,
    state: "open",
    labels: [],
    url: `https://example.invalid/issues/${overrides.number}`,
    assignees: [],
    milestone: "E6",
    createdAt: AT,
    updatedAt: AT,
    kind: "issue",
    ...rest,
  };
}

function run(overrides: Partial<RunRecord> & { readonly id: string }): RunRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    source: "codex",
    parentId: null,
    startedAt: AT,
    updatedAt: AT,
    branch: "fix/204-dsh-board-projection",
    identity: { model: "fixture", effort: "medium", provider: "fixture", profile: null },
    usage: {},
    outcome: "running",
    linkedIssues: [{ number: 204, from: "path" }],
    origin: "LOCAL_ORIGIN_SENTINEL",
    quota: [],
    ...rest,
  };
}

export function smokeInput(
  title = "Publish board projection",
  phase = "impl",
): BoardRefreshInput {
  return {
    issues: [
      issue({ number: 68, title: "Board epic", labels: ["type:epic", "epic:board", "status:impl"] }),
      issue({
        number: 204,
        title,
        labels: ["epic:board", `status:${phase}`],
        ...(phase === "shipped" ? { state: "closed", closedBecause: "completed" } : {}),
      }),
      issue({
        number: 300,
        title: "Adapter pull request",
        labels: ["epic:board", "status:impl-eval"],
        kind: "pull-request",
        draft: false,
        merged: false,
      }),
      issue({ number: 301, title: "Already delivered", labels: ["epic:board", "status:shipped"], state: "closed", closedBecause: "completed" }),
      issue({ number: 302, title: "Fix CI", labels: ["epic:board", "status:ci-fail"] }),
      issue({ number: 303, title: "Unclassified", labels: ["epic:board"] }),
    ],
    project: {
      repo: "rickylabs/harness",
      generatedAt: AT,
      completeness: { limit: 100, capped: [] },
    },
    runs: [run({ id: "parent" }), run({ id: "child", parentId: "parent", branch: null })],
    notes: ["fixture evidence"],
    telemetryComplete: true,
  };
}

/** Compose only published dsh services and this plugin; no agent, model, network, env, or disk. */
export async function runBoardProjectionSmoke(): Promise<void> {
  const ctx = new Context();
  const promptKey: string = "systemPrompt";
  ctx.provide(promptKey, { tools: () => (): void => undefined });
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  new ToolRuntime(ctx);
  todoPlugin.apply(ctx, { allowParallelInProgress: true });

  const boardFiber = await ctx.plugin(boardPlugin);
  const service = ctx.get(CONTEXT_KEY);
  if (service === undefined) throw new Error("harnessBoard service did not compose");
  const session = ctx.sessions.create();

  const first = service.refresh(session, smokeInput());
  assert.equal(session.seq, 2);
  assert.equal(first.asOfSeq, 1);
  assert.deepEqual(first.values.todos, [
    { content: "#204 Publish board projection", status: "in_progress" },
    { content: "#301 Already delivered", status: "completed" },
    { content: "#302 Fix CI", status: "pending" },
    { content: "#303 Unclassified", status: "pending" },
  ]);
  const tree = first.values.harnessBoard;
  assert.notEqual(tree, null);
  assert.equal(tree?.complete, true);
  assert.deepEqual(tree?.governance, {
    availability: "unavailable",
    observedAt: null,
    validUntil: null,
    provenance: null,
    state: null,
    admissions: [],
    unavailableReason: "no --observations supplied",
  });
  const task = tree?.milestones[0]?.epics[0]?.tasks.find((node) => node.item.number === 204);
  assert.equal(task?.runs[0]?.run.id, "parent");
  assert.equal(task?.runs[0]?.children[0]?.run.id, "child");
  const logged = JSON.stringify(session.snapshotEvents());
  assert.equal(logged.includes("LOCAL_ORIGIN_SENTINEL"), false);
  assert.equal(logged.includes('"origin"'), false);

  // A model-local todo replacement is allowed, but the next authoritative refresh replaces it.
  session.append("todo/write", { todos: [{ content: "local", status: "pending" }] });
  assert.equal(ctx.sessionProjections.snapshot(session, ["todos"]).values.todos?.[0]?.content, "local");
  const second = service.refresh(session, smokeInput("Publish refreshed projection", "shipped"));
  assert.equal(session.seq, 5);
  assert.equal(second.values.todos?.[0]?.content, "#204 Publish refreshed projection");
  assert.equal(second.values.todos?.[0]?.status, "completed");
  assert.equal(second.values.harnessBoard?.milestones[0]?.epics[0]?.tasks[0]?.item.title, "Publish refreshed projection");
  assert.equal(second.values.harnessBoard?.milestones[0]?.epics[0]?.tasks[0]?.item.phase, "shipped");

  // Consecutive calls have no await/interleaving point, and the final cut pairs one input only.
  const third = service.refresh(session, smokeInput("Publish final projection", "ci-fail"));
  assert.equal(session.seq, 7);
  assert.equal(third.values.todos?.[0]?.content, "#204 Publish final projection");
  assert.equal(third.values.todos?.[0]?.status, "pending");
  assert.equal(third.values.harnessBoard?.milestones[0]?.epics[0]?.tasks[0]?.item.title, "Publish final projection");
  assert.equal(third.values.harnessBoard?.milestones[0]?.epics[0]?.tasks[0]?.item.phase, "ci-fail");

  await boardFiber.dispose();
  assert.equal(ctx.get(CONTEXT_KEY), undefined);
  assert.equal("harnessBoard" in ctx.sessionProjections.snapshot(session).values, false);

  // Reload registers one fresh unit; lazy replay recovers its latest whole value from the log.
  const reloaded = await ctx.plugin(boardPlugin);
  assert.equal(ctx.sessionProjections.snapshot(session).values.harnessBoard?.complete, true);
  await reloaded.dispose();
}
