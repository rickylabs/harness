import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { ProjectionDefinition } from "@deepseek-ai/dsh-session-projection";
import type { TodoItem } from "@deepseek-ai/dsh-tool-todo";
import {
  bucketOf,
  type Anomaly,
  type AnomalyKind,
  type BoardSnapshot,
  type Completeness,
  type ItemKind,
} from "@rickylabs/board";
import type {
  BoardItemRef,
  PublicAttributedRun,
  PublicEpicNode,
  PublicGovernance,
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

const approvalSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    summary: z.string(),
    item: z.number().nullable(),
    runId: z.string().nullable(),
    regime: z.enum(["subscription", "metered", "capacity"]).nullable(),
    requestedAt: z.string(),
    expiresAt: z.string().nullable(),
  })
  .strict();

const regimeStateSchema = z.enum(["allow", "throttle", "pause"]);

const subscriptionRegimeSchema = z
  .object({
    regime: z.literal("subscription"),
    state: regimeStateSchema,
    accounts: z.array(z.object({
      seam: z.string(),
      account: z.string(),
      state: regimeStateSchema,
      windows: z.array(z.object({
        label: z.string(),
        windowMinutes: z.number(),
        usedPercent: z.number(),
        resetsAt: z.string().nullable(),
        binding: z.boolean(),
      }).strict()),
      observedAt: z.string().nullable(),
    }).strict()),
    note: z.string().nullable(),
  })
  .strict();

const meteredRegimeSchema = z
  .object({
    regime: z.literal("metered"),
    state: regimeStateSchema,
    providers: z.array(z.object({
      provider: z.string(),
      spentUsd: z.number(),
      ceilingUsd: z.number().nullable(),
      windowLabel: z.string(),
      observedAt: z.string().nullable(),
    }).strict()),
    note: z.string().nullable(),
  })
  .strict();

const capacityRegimeSchema = z
  .object({
    regime: z.literal("capacity"),
    state: regimeStateSchema,
    hosts: z.array(z.object({
      host: z.string(),
      vramUsedBytes: z.number().nullable(),
      vramTotalBytes: z.number().nullable(),
      ramUsedBytes: z.number().nullable(),
      ramTotalBytes: z.number().nullable(),
      observedAt: z.string().nullable(),
    }).strict()),
    note: z.string().nullable(),
  })
  .strict();

const governanceStateSchema = z
  .object({
    generatedAt: z.string(),
    regimes: z.array(z.discriminatedUnion("regime", [
      subscriptionRegimeSchema,
      meteredRegimeSchema,
      capacityRegimeSchema,
    ])),
    pending: z.array(approvalSchema),
    notes: z.array(z.string()),
  })
  .strict();

const admissionSchema = z
  .object({
    item: z.object({ number: z.number() }).strict(),
    regime: z.enum(["subscription", "metered", "capacity"]),
    state: z.enum(["throttle", "pause"]),
    availability: z.enum(["fresh", "stale"]),
    observedAt: z.string(),
    validUntil: z.string(),
    provenance: z.string(),
    outcome: z.object({
      accepted: z.literal(false),
      reason: z.string(),
      detail: z.string(),
      approval: approvalSchema.optional(),
    }).strict(),
  })
  .strict();

const availableGovernanceSchema = z
  .object({
    availability: z.enum(["fresh", "stale"]),
    observedAt: z.string(),
    validUntil: z.string(),
    provenance: z.string(),
    state: governanceStateSchema,
    admissions: z.array(admissionSchema),
    unavailableReason: z.null(),
  })
  .strict();

const unavailableGovernanceSchema = z
  .object({
    availability: z.literal("unavailable"),
    observedAt: z.null(),
    validUntil: z.null(),
    provenance: z.null(),
    state: z.null(),
    admissions: z.array(admissionSchema).max(0),
    unavailableReason: z.string(),
  })
  .strict();

const governanceSchema = z.discriminatedUnion("availability", [
  availableGovernanceSchema,
  unavailableGovernanceSchema,
]);

/**
 * The board's anomaly kinds, mirrored as a closed enum rather than widened to `z.string()`.
 *
 * A string would accept a kind this package has never heard of and hand a pane a value it cannot
 * switch on. The mirror is kept honest from both ends without a single unused assertion type: the
 * `satisfies` below rejects a kind the board does not declare, and `adaptAnomaly`'s return
 * annotation rejects a board kind missing from this tuple — a compile error naming it, rather than
 * a `parse` that throws inside a live session.
 */
const ANOMALY_KINDS = [
  "multiple-status",
  "unknown-status",
  "no-status",
  "epic-not-found",
  "closed-but-unshipped",
  "shipped-but-open",
  "closed-unmerged",
  "closed-without-status",
  "duplicate-epic-slug",
  "epic-milestone-conflict",
  "epic-closed-by-child",
  "closing-keyword-targets-epic",
  "duplicate-label",
  "incomplete-fetch",
] as const satisfies readonly AnomalyKind[];

const anomalyKindSchema = z.enum(ANOMALY_KINDS);

const ITEM_KINDS = ["issue", "pull-request"] as const satisfies readonly ItemKind[];

/** One thing wrong with the board. `item` is null for a problem with the projection itself. */
const anomalySchema = z
  .object({
    kind: anomalyKindSchema,
    item: z.number().nullable(),
    detail: z.string(),
  })
  .strict();

/** How much of the board the fetch saw. Null when the caller made no claim either way. */
const completenessSchema = z
  .object({
    limit: z.number(),
    capped: z.array(z.enum(ITEM_KINDS)),
  })
  .strict();

const itemSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    epic: z.string().nullable(),
    milestone: z.string().nullable(),
    phase: z.string().nullable(),
    /**
     * The anomaly kinds naming this item, absent when none do.
     *
     * Redundant with the board-level `anomalies` array by construction, and deliberately so: a pane
     * drawing a column has the item in hand and must not scan every anomaly per row to find out
     * whether the phase beside it is disputed. The join is done once, here, deterministically.
     *
     * Kinds only — the detail and the repair live on the board-level entry, which is the one place
     * they can be read without being attached to a row that may not be the whole story.
     */
    anomalies: z.array(anomalyKindSchema).optional(),
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
    /**
     * Whether *every* source behind this cut was read whole: the telemetry scan and the board
     * fetch, folded to one boolean by the caller.
     *
     * Kept alongside `completeness` rather than replaced by it, because the two answer different
     * questions and a reader who conflates them gets a wrong answer either way. This one is the
     * safe-to-believe flag and is false if anything at all was truncated; `completeness` says
     * which board kinds were capped and at what limit, and says nothing about telemetry.
     */
    complete: z.boolean(),
    /**
     * The board fetch's own coverage, or null when the caller made no claim.
     *
     * A banner rather than one anomaly among many: an item missing from a truncated board looks
     * exactly like an item that does not exist, so this is the sentence that decides whether the
     * columns can be read at all.
     */
    completeness: completenessSchema.nullable(),
    /**
     * Every anomaly on the board, board-level ones included, with detail.
     *
     * Detail travels rather than a pointer to `dsh-board check`. The terminal banner can send a
     * reader to another command because a reader at a terminal can run it; a cockpit pane cannot,
     * and telling it to would rebuild the "ask an agent for status" round trip this projection
     * exists to remove.
     */
    anomalies: z.array(anomalySchema),
    milestones: z.array(milestoneNodeSchema),
    unattributed: z.array(attributedSchema),
    quota: z.array(quotaSchema),
    governance: governanceSchema,
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

/** Item number to the distinct anomaly kinds naming it. Built once per projection. */
type AnomalyMarks = ReadonlyMap<number, readonly AnomalyKind[]>;

/**
 * Index the anomalies that name an item.
 *
 * Board-level anomalies carry no item and are skipped, matching `anomalousItems` in the terminal
 * renderer: a truncated fetch is a statement about the projection, and hanging its mark on
 * whichever row happened to be first would blame an issue for something that is not about it.
 * Those reach the reader through `completeness` and the board-level `anomalies` array instead.
 *
 * Kinds are deduplicated. Two `duplicate-label` anomalies on one item are two facts about two
 * label families, and both are carried in full at board level; repeating the kind in the item's
 * mark would say nothing a pane can act on.
 */
function markItems(anomalies: readonly Anomaly[]): AnomalyMarks {
  const marks = new Map<number, AnomalyKind[]>();
  for (const anomaly of anomalies) {
    if (anomaly.item === null) continue;
    const kinds = marks.get(anomaly.item);
    if (kinds === undefined) marks.set(anomaly.item, [anomaly.kind]);
    else if (!kinds.includes(anomaly.kind)) kinds.push(anomaly.kind);
  }
  return marks;
}

/** The annotation is the exhaustiveness check: a new board kind fails to assign to the enum. */
function adaptAnomaly(anomaly: Anomaly): z.output<typeof anomalySchema> {
  return { kind: anomaly.kind, item: anomaly.item, detail: anomaly.detail };
}

function adaptItem(item: BoardItemRef, marks: AnomalyMarks): z.output<typeof itemSchema> {
  const anomalies = marks.get(item.number);
  return {
    number: item.number,
    title: item.title,
    epic: item.epic,
    milestone: item.milestone,
    phase: item.phase,
    ...(anomalies === undefined ? {} : { anomalies: [...anomalies] }),
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

function adaptApproval(
  approval: NonNullable<PublicGovernance["state"]>["pending"][number],
): z.output<typeof approvalSchema> {
  return {
    id: approval.id,
    kind: approval.kind,
    summary: approval.summary,
    item: approval.item,
    runId: approval.runId,
    regime: approval.regime,
    requestedAt: approval.requestedAt,
    expiresAt: approval.expiresAt,
  };
}

function adaptGovernance(governance: PublicGovernance): z.output<typeof governanceSchema> {
  if (governance.availability === "unavailable") {
    if (governance.unavailableReason === null) {
      throw new Error("unavailable governance requires a reason");
    }
    return {
      availability: governance.availability,
      observedAt: null,
      validUntil: null,
      provenance: null,
      state: null,
      admissions: [],
      unavailableReason: governance.unavailableReason,
    };
  }
  const { observedAt, validUntil, provenance, state } = governance;
  if (observedAt === null || validUntil === null || provenance === null || state === null) {
    throw new Error("available governance requires observation metadata and state");
  }
  return {
    availability: governance.availability,
    observedAt,
    validUntil,
    provenance,
    state: {
      generatedAt: state.generatedAt,
      regimes: state.regimes.map((regime) => {
        if (regime.regime === "subscription") {
          return {
            regime: regime.regime,
            state: regime.state,
            accounts: regime.accounts.map((account) => ({
              seam: account.seam,
              account: account.account,
              state: account.state,
              windows: account.windows.map((window) => ({
                label: window.label,
                windowMinutes: window.windowMinutes,
                usedPercent: window.usedPercent,
                resetsAt: window.resetsAt,
                binding: window.binding,
              })),
              observedAt: account.observedAt,
            })),
            note: regime.note,
          };
        }
        if (regime.regime === "metered") {
          return {
            regime: regime.regime,
            state: regime.state,
            providers: regime.providers.map((provider) => ({
              provider: provider.provider,
              spentUsd: provider.spentUsd,
              ceilingUsd: provider.ceilingUsd,
              windowLabel: provider.windowLabel,
              observedAt: provider.observedAt,
            })),
            note: regime.note,
          };
        }
        return {
          regime: regime.regime,
          state: regime.state,
          hosts: regime.hosts.map((host) => ({
            host: host.host,
            vramUsedBytes: host.vramUsedBytes,
            vramTotalBytes: host.vramTotalBytes,
            ramUsedBytes: host.ramUsedBytes,
            ramTotalBytes: host.ramTotalBytes,
            observedAt: host.observedAt,
          })),
          note: regime.note,
        };
      }),
      pending: state.pending.map(adaptApproval),
      notes: [...state.notes],
    },
    admissions: governance.admissions.map((admission) => ({
      item: { number: admission.item.number },
      regime: admission.regime,
      state: admission.state,
      availability: admission.availability,
      observedAt: admission.observedAt,
      validUntil: admission.validUntil,
      provenance: admission.provenance,
      outcome: {
        accepted: false,
        reason: admission.outcome.reason,
        detail: admission.outcome.detail,
        ...(admission.outcome.approval === undefined
          ? {}
          : { approval: adaptApproval(admission.outcome.approval) }),
      },
    })),
    unavailableReason: null,
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

function adaptAttributed(attributed: PublicAttributedRun, marks: AnomalyMarks): AttributedDto {
  return {
    run: adaptRun(attributed.run),
    item: attributed.item === null ? null : adaptItem(attributed.item, marks),
    children: attributed.children.map((child) => adaptAttributed(child, marks)),
  };
}

function adaptItemNode(node: PublicItemNode, marks: AnomalyMarks): z.output<typeof itemNodeSchema> {
  return {
    item: adaptItem(node.item, marks),
    runs: node.runs.map((run) => adaptAttributed(run, marks)),
    links: node.links.map((link) => ({
      number: link.number,
      from: link.from,
      item: link.item === null ? null : adaptItem(link.item, marks),
    })),
    liveness: { ...node.liveness },
  };
}

function adaptEpicNode(node: PublicEpicNode, marks: AnomalyMarks): z.output<typeof epicNodeSchema> {
  return {
    epic: node.epic,
    item: node.item === null ? null : adaptItem(node.item, marks),
    tasks: node.tasks.map((task) => adaptItemNode(task, marks)),
    pulls: node.pulls.map((pull) => adaptItemNode(pull, marks)),
    liveness: { ...node.liveness },
  };
}

function adaptMilestoneNode(
  node: PublicMilestoneNode,
  marks: AnomalyMarks,
): z.output<typeof milestoneNodeSchema> {
  return {
    milestone: node.milestone,
    epics: node.epics.map((epic) => adaptEpicNode(epic, marks)),
    liveness: { ...node.liveness },
  };
}

/**
 * What the board contributes that the activity tree cannot.
 *
 * Narrower than `BoardSnapshot` so the signature states exactly what is read, and structurally
 * satisfied by one, so the caller passes the snapshot it already holds. Telemetry is the wrong
 * place to carry these: it takes a flat `BoardItemRef[]` and does not depend on `@rickylabs/board`
 * at all, and consistency of the label taxonomy is not a fact about runs or liveness. `dsh-app` is
 * where the two evidence sources already meet.
 */
export interface BoardEvidence {
  readonly anomalies: readonly Anomaly[];
  readonly completeness: Completeness | null;
}

/**
 * Allowlisted conversion from telemetry's public tree to our independently strict wire shape.
 *
 * The board half is a second argument rather than something the tree grew, because a projection
 * that renders `phase` while dropping `anomalies` is claiming a consistency it never checked: on
 * an item carrying two `status:` labels the phase resolves to whichever label came first, and
 * nothing downstream can tell that one of two answers was picked.
 */
export function toBoardProjection(tree: PublicTree, board: BoardEvidence): BoardProjection {
  const marks = markItems(board.anomalies);
  return boardProjectionSchema.parse({
    generatedAt: tree.generatedAt,
    now: tree.now,
    complete: tree.complete,
    completeness:
      board.completeness === null
        ? null
        : { limit: board.completeness.limit, capped: [...board.completeness.capped] },
    anomalies: board.anomalies.map(adaptAnomaly),
    milestones: tree.milestones.map((node) => adaptMilestoneNode(node, marks)),
    unattributed: tree.unattributed.map((run) => adaptAttributed(run, marks)),
    quota: tree.quota.map(adaptQuota),
    governance: adaptGovernance(tree.governance),
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
  // 2 adds board anomalies and fetch completeness. The bump is what discards a persisted
  // projection-cache row written by 1: the registry serves a cached row only when its `ver`
  // matches, so without it a stale value from before these fields existed would be handed back as
  // a board with nothing wrong on it — the exact claim this version was added to stop making.
  stateVersion: 2,
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
