/**
 * What leaves this machine.
 *
 * `--json` output is piped into other tools, pasted into issues and consumed by the board
 * projection, so it is a published surface and not a debug dump. Two things follow.
 *
 * First, every field is listed by hand. `JSON.stringify(record)` publishes whatever the record
 * happens to carry, which means the next field someone adds to `RunRecord` is published the moment
 * it exists, by nobody's decision. `RunRecord.origin` is the standing example: it is a path naming
 * a person's home directory, its own doc comment says it "is excluded from every projection meant
 * to leave this machine", and until this module existed nothing excluded it. An allowlist makes
 * that claim true by construction — a new field is absent until someone adds it here.
 *
 * Second, the envelope says whether the answer is complete. A bare array of runs is shaped exactly
 * like complete evidence whether or not the scan that produced it was truncated (finding F-10 on
 * #105), and a machine consumer has no way to tell. `complete` is the same fact the exit status
 * carries, in the form a program reads.
 *
 * `why` is deliberately not projected through here: it is the local operator's command, and its
 * entire job is to hand back the path to open.
 */

import type {
  GovernanceState,
  PendingApproval,
  RegimeStatus,
} from "@rickylabs/harness-contracts";

import type { Liveness } from "./liveness.js";
import type {
  AttributedRun,
  BoardItemRef,
  EpicActivity,
  IssueLink,
  LaunchIdentity,
  QuotaReading,
  RunOutcome,
  RunRecord,
  RunSource,
  RunUsage,
  TelemetrySnapshot,
} from "./model.js";
import type { ActivityTree, EpicNode, ItemNode, LinkedRef, MilestoneNode } from "./tree.js";
import type { AdmissionView, GovernanceView, ObservationAvailability } from "./observations.js";

/** A run as published: `RunRecord` minus `origin`. */
export interface PublicRun {
  readonly id: string;
  readonly source: RunSource;
  readonly parentId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly branch: string | null;
  readonly identity: LaunchIdentity;
  readonly usage: RunUsage;
  readonly outcome: RunOutcome;
  readonly linkedIssues: readonly IssueLink[];
  readonly quota: readonly QuotaReading[];
}

/**
 * The keys `publicRun` emits, sorted.
 *
 * Exported so the allowlist is checkable rather than merely intended: a test asserts this is
 * exactly what comes out, so adding a field to `RunRecord` without deciding whether it is publishable
 * fails a test instead of shipping.
 */
export const PUBLIC_RUN_KEYS = [
  "branch",
  "id",
  "identity",
  "linkedIssues",
  "outcome",
  "parentId",
  "quota",
  "source",
  "startedAt",
  "updatedAt",
  "usage",
] as const;

export interface PublicAttributedRun {
  readonly run: PublicRun;
  readonly item: BoardItemRef | null;
  readonly children: readonly PublicAttributedRun[];
}

export interface PublicEpic {
  readonly epic: string;
  readonly milestone: string | null;
  readonly runs: readonly PublicAttributedRun[];
}

/** A snapshot as published, with the completeness of the scan that produced it stated on it. */
export interface PublicSnapshot {
  readonly generatedAt: string;
  /** False when a store could not be read or a scan was truncated. See the CLI's exit status 3. */
  readonly complete: boolean;
  readonly epics: readonly PublicEpic[];
  readonly unattributed: readonly PublicAttributedRun[];
  readonly quota: readonly QuotaReading[];
  readonly governance: PublicGovernance;
  readonly notes: readonly string[];
}

export interface PublicAdmission {
  readonly item: { readonly number: number };
  readonly regime: AdmissionView["regime"];
  readonly state: AdmissionView["state"];
  readonly availability: AdmissionView["availability"];
  readonly observedAt: string;
  readonly validUntil: string;
  readonly provenance: string;
  readonly outcome: {
    readonly accepted: false;
    readonly reason: string;
    readonly detail: string;
    readonly approval?: PendingApproval;
  };
}

export interface PublicGovernance {
  readonly availability: ObservationAvailability;
  readonly observedAt: string | null;
  readonly validUntil: string | null;
  readonly provenance: string | null;
  readonly state: GovernanceState | null;
  readonly admissions: readonly PublicAdmission[];
  readonly unavailableReason: string | null;
}

function publicApproval(approval: PendingApproval): PendingApproval {
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

function publicRegime(value: RegimeStatus): RegimeStatus {
  if (value.regime === "subscription") {
    return {
      regime: value.regime,
      state: value.state,
      accounts: value.accounts.map((account) => ({
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
      note: value.note,
    };
  }
  if (value.regime === "metered") {
    return {
      regime: value.regime,
      state: value.state,
      providers: value.providers.map((provider) => ({
        provider: provider.provider,
        spentUsd: provider.spentUsd,
        ceilingUsd: provider.ceilingUsd,
        windowLabel: provider.windowLabel,
        observedAt: provider.observedAt,
      })),
      note: value.note,
    };
  }
  return {
    regime: value.regime,
    state: value.state,
    hosts: value.hosts.map((host) => ({
      host: host.host,
      vramUsedBytes: host.vramUsedBytes,
      vramTotalBytes: host.vramTotalBytes,
      ramUsedBytes: host.ramUsedBytes,
      ramTotalBytes: host.ramTotalBytes,
      observedAt: host.observedAt,
    })),
    note: value.note,
  };
}

function publicState(value: GovernanceState): GovernanceState {
  return {
    generatedAt: value.generatedAt,
    regimes: value.regimes.map(publicRegime),
    pending: value.pending.map(publicApproval),
    notes: [...value.notes],
  };
}

function publicAdmission(value: AdmissionView): PublicAdmission {
  const approval = value.outcome.approval;
  return {
    item: { number: value.item.number },
    regime: value.regime,
    state: value.state,
    availability: value.availability,
    observedAt: value.observedAt,
    validUntil: value.validUntil,
    provenance: value.provenance,
    outcome: {
      accepted: false,
      reason: value.outcome.reason,
      detail: value.outcome.detail,
      ...(approval === undefined ? {} : { approval: publicApproval(approval) }),
    },
  };
}

/** Project governance field by field; file paths and loader details have no route into this shape. */
export function publicGovernance(value: GovernanceView): PublicGovernance {
  if (value.availability === "unavailable") {
    return {
      availability: value.availability,
      observedAt: null,
      validUntil: null,
      provenance: null,
      state: null,
      admissions: [],
      unavailableReason: value.unavailableReason,
    };
  }
  return {
    availability: value.availability,
    observedAt: value.observedAt,
    validUntil: value.validUntil,
    provenance: value.provenance,
    state: publicState(value.state),
    admissions: value.admissions.map(publicAdmission),
    unavailableReason: null,
  };
}

/** What `runs --json` returns: the same envelope, flat. */
export interface PublicRuns {
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly runs: readonly PublicRun[];
  readonly notes: readonly string[];
}

/** Project one run. Field by field, on purpose — see the module header. */
export function publicRun(run: RunRecord): PublicRun {
  return {
    id: run.id,
    source: run.source,
    parentId: run.parentId,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    branch: run.branch,
    identity: run.identity,
    usage: run.usage,
    outcome: run.outcome,
    linkedIssues: run.linkedIssues,
    quota: run.quota,
  };
}

function publicAttributed(attributed: AttributedRun): PublicAttributedRun {
  return {
    run: publicRun(attributed.run),
    item: attributed.item,
    children: attributed.children.map(publicAttributed),
  };
}

function publicEpic(epic: EpicActivity): PublicEpic {
  return { epic: epic.epic, milestone: epic.milestone, runs: epic.runs.map(publicAttributed) };
}

/** Project a whole snapshot, subagent trees included. */
export function publicSnapshot(snapshot: TelemetrySnapshot, complete: boolean): PublicSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    complete,
    epics: snapshot.epics.map(publicEpic),
    unattributed: snapshot.unattributed.map(publicAttributed),
    quota: snapshot.quota,
    governance: publicGovernance(snapshot.governance),
    notes: snapshot.notes,
  };
}

/**
 * The tree as published.
 *
 * Only the runs need projecting: `BoardItemRef`, `LinkedRef` and `Liveness` hold numbers, titles,
 * labels and timestamps that came from GitHub in the first place, and nothing that names this
 * machine. The nesting is rebuilt by hand anyway, for the reason the module header gives — a field
 * added to a node type should not become a published field by nobody's decision.
 */
export interface PublicItemNode {
  readonly item: BoardItemRef;
  readonly runs: readonly PublicAttributedRun[];
  readonly links: readonly LinkedRef[];
  readonly liveness: Liveness;
}

export interface PublicEpicNode {
  readonly epic: string | null;
  readonly item: BoardItemRef | null;
  readonly tasks: readonly PublicItemNode[];
  readonly pulls: readonly PublicItemNode[];
  readonly liveness: Liveness;
}

export interface PublicMilestoneNode {
  readonly milestone: string | null;
  readonly epics: readonly PublicEpicNode[];
  readonly liveness: Liveness;
}

export interface PublicTree {
  readonly generatedAt: string;
  readonly now: string;
  readonly complete: boolean;
  readonly milestones: readonly PublicMilestoneNode[];
  readonly unattributed: readonly PublicAttributedRun[];
  readonly quota: readonly QuotaReading[];
  readonly governance: PublicGovernance;
  readonly notes: readonly string[];
}

function publicItemNode(node: ItemNode): PublicItemNode {
  return {
    item: node.item,
    runs: node.runs.map(publicAttributed),
    links: node.links,
    liveness: node.liveness,
  };
}

function publicEpicNode(node: EpicNode): PublicEpicNode {
  return {
    epic: node.epic,
    item: node.item,
    tasks: node.tasks.map(publicItemNode),
    pulls: node.pulls.map(publicItemNode),
    liveness: node.liveness,
  };
}

function publicMilestoneNode(node: MilestoneNode): PublicMilestoneNode {
  return {
    milestone: node.milestone,
    epics: node.epics.map(publicEpicNode),
    liveness: node.liveness,
  };
}

/** Project the whole tree, subagent trees included. */
export function publicTree(tree: ActivityTree, complete: boolean): PublicTree {
  return {
    generatedAt: tree.generatedAt,
    now: tree.now,
    complete,
    milestones: tree.milestones.map(publicMilestoneNode),
    unattributed: tree.unattributed.map(publicAttributed),
    quota: tree.quota,
    governance: publicGovernance(tree.governance),
    notes: tree.notes,
  };
}

/** Project a flat run list into the same envelope. */
export function publicRuns(
  generatedAt: string,
  runs: readonly RunRecord[],
  notes: readonly string[],
  complete: boolean,
): PublicRuns {
  return { generatedAt, complete, runs: runs.map(publicRun), notes };
}
