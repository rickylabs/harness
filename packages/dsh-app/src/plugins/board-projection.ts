import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
import type { TodoItem } from "@deepseek-ai/dsh-tool-todo";
import { bucketOf, type BoardSnapshot } from "@rickylabs/board";
import type {
  BoardItemRef,
  PublicAttributedRun,
  PublicEpicNode,
  PublicItemNode,
  PublicMilestoneNode,
  PublicRun,
  PublicTree,
  QuotaReading,
} from "@rickylabs/telemetry";
import { z } from "zod";

export const BOARD_PROJECTION_KEY = "harnessBoard" as const;
export const BOARD_WRITE_EVENT = "harness/board-write" as const;

const usageSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .strict();

const identitySchema = z
  .object({
    model: z.string().nullable(),
    effort: z.string().nullable(),
    provider: z.string().nullable(),
    profile: z.string().nullable(),
  })
  .strict();

const quotaSchema = z
  .object({
    source: z.enum(["claude", "codex", "opencode"]),
    observedAt: z.string(),
    limitId: z.string().nullable(),
    usedPercent: z.number().nullable(),
    windowMinutes: z.number().nullable(),
    resetsAt: z.string().nullable(),
    planType: z.string().nullable(),
    creditBalance: z.string().nullable(),
  })
  .strict();

const itemSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    epic: z.string().nullable(),
    milestone: z.string().nullable(),
    phase: z.string().nullable(),
    kind: z.enum(["issue", "pull-request"]).optional(),
    state: z.enum(["open", "closed"]).optional(),
    merged: z.boolean().optional(),
    isEpic: z.boolean().optional(),
    closes: z.array(z.number()).optional(),
    url: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

const livenessSchema = z
  .object({
    state: z.enum(["live", "recent", "stalled", "quiet"]),
    evidence: z.enum(["turn", "item", "none"]),
    at: z.string().nullable(),
    ageMs: z.number().nullable(),
  })
  .strict();

const runSchema = z
  .object({
    id: z.string(),
    source: z.enum(["claude", "codex", "opencode"]),
    parentId: z.string().nullable(),
    startedAt: z.string(),
    updatedAt: z.string(),
    branch: z.string().nullable(),
    identity: identitySchema,
    usage: usageSchema,
    outcome: z.enum(["running", "complete", "failed", "unknown"]),
    linkedIssues: z.array(
      z.object({ number: z.number(), from: z.enum(["path", "prose"]) }).strict(),
    ),
    quota: z.array(quotaSchema),
  })
  .strict();

const attributedSchema = z.strictObject({
  run: runSchema,
  item: itemSchema.nullable(),
  get children() {
    return z.array(attributedSchema);
  },
});

const linkedSchema = z
  .object({
    number: z.number(),
    from: z.enum(["closes", "path", "prose"]),
    item: itemSchema.nullable(),
  })
  .strict();

const itemNodeSchema = z
  .object({
    item: itemSchema,
    runs: z.array(attributedSchema),
    links: z.array(linkedSchema),
    liveness: livenessSchema,
  })
  .strict();

const epicNodeSchema = z
  .object({
    epic: z.string().nullable(),
    item: itemSchema.nullable(),
    tasks: z.array(itemNodeSchema),
    pulls: z.array(itemNodeSchema),
    liveness: livenessSchema,
  })
  .strict();

const milestoneNodeSchema = z
  .object({
    milestone: z.string().nullable(),
    epics: z.array(epicNodeSchema),
    liveness: livenessSchema,
  })
  .strict();

/** Exact wire contract: every object rejects undeclared root and nested fields. */
export const boardProjectionSchema = z
  .object({
    generatedAt: z.string(),
    now: z.string(),
    complete: z.boolean(),
    milestones: z.array(milestoneNodeSchema),
    unattributed: z.array(attributedSchema),
    quota: z.array(quotaSchema),
    notes: z.array(z.string()),
  })
  .strict();

/** Wire DTO is derived from the behavioral schema, rather than from the richer internal tree. */
export type BoardProjection = z.output<typeof boardProjectionSchema>;

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    "harness/board-write": { board: BoardProjection };
  }
}

declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionStateMap {
    harnessBoard: BoardProjection | null;
  }
  interface SessionProjectionMap {
    harnessBoard: BoardProjection | null;
  }
}

function adaptItem(item: BoardItemRef): z.output<typeof itemSchema> {
  return {
    number: item.number,
    title: item.title,
    epic: item.epic,
    milestone: item.milestone,
    phase: item.phase,
    ...(item.kind === undefined ? {} : { kind: item.kind }),
    ...(item.state === undefined ? {} : { state: item.state }),
    ...(item.merged === undefined ? {} : { merged: item.merged }),
    ...(item.isEpic === undefined ? {} : { isEpic: item.isEpic }),
    ...(item.closes === undefined ? {} : { closes: [...item.closes] }),
    ...(item.url === undefined ? {} : { url: item.url }),
    ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
  };
}

function adaptQuota(quota: QuotaReading): z.output<typeof quotaSchema> {
  return {
    source: quota.source,
    observedAt: quota.observedAt,
    limitId: quota.limitId,
    usedPercent: quota.usedPercent,
    windowMinutes: quota.windowMinutes,
    resetsAt: quota.resetsAt,
    planType: quota.planType,
    creditBalance: quota.creditBalance,
  };
}

function adaptRun(run: PublicRun): z.output<typeof runSchema> {
  return {
    id: run.id,
    source: run.source,
    parentId: run.parentId,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    branch: run.branch,
    identity: { ...run.identity },
    usage: {
      ...(run.usage.inputTokens === undefined ? {} : { inputTokens: run.usage.inputTokens }),
      ...(run.usage.outputTokens === undefined ? {} : { outputTokens: run.usage.outputTokens }),
      ...(run.usage.reasoningTokens === undefined ? {} : { reasoningTokens: run.usage.reasoningTokens }),
      ...(run.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: run.usage.cacheReadTokens }),
      ...(run.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: run.usage.cacheWriteTokens }),
      ...(run.usage.costUsd === undefined ? {} : { costUsd: run.usage.costUsd }),
    },
    outcome: run.outcome,
    linkedIssues: run.linkedIssues.map((link) => ({ number: link.number, from: link.from })),
    quota: run.quota.map(adaptQuota),
  };
}

type AttributedDto = z.output<typeof attributedSchema>;

function adaptAttributed(attributed: PublicAttributedRun): AttributedDto {
  return {
    run: adaptRun(attributed.run),
    item: attributed.item === null ? null : adaptItem(attributed.item),
    children: attributed.children.map(adaptAttributed),
  };
}

function adaptItemNode(node: PublicItemNode): z.output<typeof itemNodeSchema> {
  return {
    item: adaptItem(node.item),
    runs: node.runs.map(adaptAttributed),
    links: node.links.map((link) => ({
      number: link.number,
      from: link.from,
      item: link.item === null ? null : adaptItem(link.item),
    })),
    liveness: { ...node.liveness },
  };
}

function adaptEpicNode(node: PublicEpicNode): z.output<typeof epicNodeSchema> {
  return {
    epic: node.epic,
    item: node.item === null ? null : adaptItem(node.item),
    tasks: node.tasks.map(adaptItemNode),
    pulls: node.pulls.map(adaptItemNode),
    liveness: { ...node.liveness },
  };
}

function adaptMilestoneNode(node: PublicMilestoneNode): z.output<typeof milestoneNodeSchema> {
  return {
    milestone: node.milestone,
    epics: node.epics.map(adaptEpicNode),
    liveness: { ...node.liveness },
  };
}

/** Allowlisted conversion from telemetry's public tree to our independently strict wire shape. */
export function toBoardProjection(tree: PublicTree): BoardProjection {
  return boardProjectionSchema.parse({
    generatedAt: tree.generatedAt,
    now: tree.now,
    complete: tree.complete,
    milestones: tree.milestones.map(adaptMilestoneNode),
    unattributed: tree.unattributed.map(adaptAttributed),
    quota: tree.quota.map(adaptQuota),
    notes: [...tree.notes],
  });
}

/** Project actionable board issues into dsh's whole-list todo contract. */
export function todosFromBoard(snapshot: BoardSnapshot): TodoItem[] {
  return snapshot.items
    .filter((item) => !item.isEpic && item.source.kind !== "pull-request")
    .map((item) => {
      const bucket = bucketOf(item);
      return {
        content: `#${item.source.number} ${item.source.title}`,
        status: bucket === "shipped"
          ? "completed"
          : bucket === "inFlight"
            ? "in_progress"
            : "pending",
      };
    });
}

type BoardProjectionDefinition = ProjectionDefinition<"harnessBoard", BoardProjection | null>;

export const boardProjectionDefinition = {
  key: BOARD_PROJECTION_KEY,
  stateSchema: boardProjectionSchema.nullable(),
  init: () => null,
  apply(state, event: SessionEvent) {
    return event.type === BOARD_WRITE_EVENT ? event.data.board : state;
  },
  wire: {
    viewSchema: boardProjectionSchema.nullable(),
    view: (state) => state,
  },
  stateVersion: 1,
} satisfies Omit<BoardProjectionDefinition, "wire"> & {
  wire: NonNullable<BoardProjectionDefinition["wire"]>;
};

/** Two-event synchronous commit; callers must finish every fallible preflight before entering. */
export function appendBoardRefresh(
  session: Session,
  todos: readonly TodoItem[],
  board: BoardProjection,
): void {
  session.append("todo/write", { todos: [...todos] });
  session.append(BOARD_WRITE_EVENT, { board });
}
