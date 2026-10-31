/** Native root census. Extend the join here; liveness never depends on transcript or process history. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { orchidHost, NATIVE_RUN_BATCH_LIMIT, type NativeRunQuery, type NativeRunRecord } from "@rickylabs/host-orchid";
import { ISSUE_AGENT_TREE_FRESH_MS, MAX_AGENT_OBSERVATIONS, readIssueAgentTreeSnapshot,
  type DispatchEvidence, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { buildAgentObservations, type NativeRootObservation } from "./agent-observations.js";
import { buildIssueAgentTreeSnapshot } from "./issue-agent-feed.js";
import { resolveNativeOperatorBindings, type OperatorEnvironment } from "./operator-environment.js";
import { resolveWireFamily } from "./producer-names.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const handle = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const label = /^(codex|claude|agy|opencode)-([1-9][0-9]{0,15})$/;
const id = (value: unknown): value is string => typeof value === "string" && Buffer.byteLength(value) <= 512 &&
  value.length > 0 && !/[\x00-\x20\x7f]/.test(value);
interface Seat { readonly workspace: string; readonly pane: string; readonly terminal: string;
  readonly source: "codex" | "claude" | "agy" | "opencode"; readonly id: string | null;
  readonly state: string; readonly revision: unknown }
interface Binding { readonly agentId: string; readonly dispatchId: string; readonly terminalId: string; readonly paneId: string }
interface Lookup { readonly terminalId: string; readonly paneId: string;
  readonly outcome: "bound" | "none" | "unresolved" | "unverified" | "not_looked_up" }
export interface NativeIssueAgentRead {
  readonly issueAgentTree: IssueAgentTreeSnapshot;
  readonly bindings: readonly Binding[];
  readonly lookups: readonly Lookup[];
  readonly coverage: { readonly complete: boolean };
  readonly completedRuns: readonly { readonly agentId: string; readonly dispatchId: string }[];
  readonly rootMetadata: { readonly observedAt: string; readonly validUntil: string; readonly revision: string;
    readonly issues: readonly unknown[] };
}
export function unavailableNativeTree(now: string, reason: IssueAgentTreeSnapshot["reason"] = "source_unavailable"): IssueAgentTreeSnapshot {
  return { schema: 1, protocol: 1, observedAt: now,
    validUntil: new Date(Date.parse(now) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
    revision: digest({ reason }), complete: false, reason, issues: [] };
}
/** Official Herdr command reads the same socket snapshot as the cockpit's existing native reader. */
export async function readHerdrNativeSnapshot(): Promise<unknown> {
  const { stdout } = await promisify(execFile)("herdr", ["api", "snapshot"], { timeout: 5000, maxBuffer: 4 * 1_048_576 });
  const response: unknown = JSON.parse(stdout);
  if (object(response) && object(response.result) && object(response.result.snapshot)) return response.result.snapshot;
  return object(response) && object(response.snapshot) ? response.snapshot : response;
}
/** Input is private structured Herdr data, never terminal content or a public request payload. */
export async function collectNativeIssueAgents(input: {
  readonly nativeSnapshot: unknown; readonly env: OperatorEnvironment; readonly now: string; readonly issueKey?: string;
  /** Private attachment metadata may reuse the certified receipt; it supplies no execution facts. */
  readonly onBinding?: (receipt: DispatchEvidence, binding: Readonly<Binding>) => Promise<void>;
}): Promise<NativeIssueAgentRead> {
  let tree = unavailableNativeTree(input.now);
  const bindings: Binding[] = [], lookups: Lookup[] = [];
  const completedRuns: { agentId: string; dispatchId: string }[] = [];
  let complete = true;
  const finish = (): NativeIssueAgentRead => ({ issueAgentTree: tree, bindings, lookups,
    coverage: { complete }, completedRuns, rootMetadata: { observedAt: tree.observedAt, validUntil: tree.validUntil, revision: tree.revision,
      issues: tree.issues.map(({ repo, issueNumber, dispatches }) => ({ repo, issueNumber, dispatches })) } });
  try {
    const config = resolveNativeOperatorBindings(input.env), wireFamily = resolveWireFamily(input.env);
    if (!config.dispatchRoot || !config.orchidRunSocket) { complete = false; return finish(); }
    const raw = input.nativeSnapshot;
    if (!object(raw) || !Array.isArray(raw.workspaces) || !Array.isArray(raw.agents)) throw Error();
    // This is a current native census bound, independent of retained receipts. Never select a history prefix.
    if (raw.agents.length > MAX_AGENT_OBSERVATIONS) { tree = unavailableNativeTree(input.now, "scan_limit"); complete = false; return finish(); }
    const workspaces = new Map<string, string>(), ambiguous = new Set<string>();
    for (const row of raw.workspaces) {
      if (!object(row) || !handle(row.workspace_id) || typeof row.label !== "string") throw Error();
      if (workspaces.has(row.workspace_id)) ambiguous.add(row.workspace_id);
      workspaces.set(row.workspace_id, row.label);
    }
    const seats: Seat[] = [];
    for (const row of raw.agents) {
      if (!object(row) || !handle(row.workspace_id) || !handle(row.pane_id) || !handle(row.terminal_id) ||
          !["codex", "claude", "agy", "opencode"].includes(row.agent as string)) { complete = false; continue; }
      const session = row.agent_session;
      const nativeId = object(session) && session.agent === row.agent && session.kind === "id" &&
        typeof session.source === "string" && /^herdr:[a-z][a-z0-9_-]*$/.test(session.source) && id(session.value) ? session.value : null;
      seats.push({ workspace: row.workspace_id, pane: row.pane_id, terminal: row.terminal_id, source: row.agent as Seat["source"],
        id: nativeId, state: row.launch_pending === true ? "unknown" : String(row.agent_status),
        revision: [row.revision, row.state_change_seq] });
    }
    const candidates = new Map<string, { query: NativeRunQuery; seat: Seat }>();
    const duplicateKeys = new Set<string>();
    for (const seat of seats) {
      const workspaceLabel = workspaces.get(seat.workspace);
      const match = label.exec(workspaceLabel ?? "");
      let outcome: Lookup["outcome"] = !seat.id ? "not_looked_up" : workspaceLabel === undefined ? "unverified" : "none";
      if (match) {
        outcome = "unresolved";
        const key = match[2]!;
        if (candidates.has(key)) duplicateKeys.add(key);
        if (seat.source === match[1] && !ambiguous.has(seat.workspace) && seat.id !== null && Number.isSafeInteger(Number(key))) {
          candidates.set(key, { query: { key, label: workspaceLabel! }, seat });
        } else duplicateKeys.add(key);
      }
      lookups.push({ terminalId: seat.terminal, paneId: seat.pane, outcome });
    }
    for (const key of duplicateKeys) candidates.delete(key);
    if (duplicateKeys.size) complete = false;
    const selected = [...candidates.values()];
    const records: NativeRunRecord[] = [];
    if (selected.length === 0) {
      const health = await orchidHost.lookupNativeRuns(config.orchidRunSocket, []);
      if (!health.complete) complete = false;
    }
    for (const [workspace, workspaceLabel] of workspaces) {
      if (label.test(workspaceLabel) && !seats.some(seat => seat.workspace === workspace)) complete = false;
    }
    for (let at = 0; at < selected.length; at += NATIVE_RUN_BATCH_LIMIT) {
      const read = await orchidHost.lookupNativeRuns(config.orchidRunSocket,
        selected.slice(at, at + NATIVE_RUN_BATCH_LIMIT).map(row => row.query));
      if (!read.complete || read.missing.length) complete = false;
      records.push(...read.records);
    }
    const dispatches: DispatchEvidence[] = [], roots = new Map<string, NativeRootObservation>();
    const usedReceipts = new Set<string>();
    const duplicatedReceipts = new Set(records.filter((row, i) => records.some((other, j) =>
      i !== j && row.dispatchKey === other.dispatchKey)).map(row => row.dispatchKey));
    for (const record of records) {
      const candidate = candidates.get(record.key), seat = candidate?.seat;
      if (!seat || seat.id !== record.nativeSessionId || duplicatedReceipts.has(record.dispatchKey) ||
          usedReceipts.has(record.dispatchKey) || seats.filter(other => other.pane === seat.pane ||
            other.terminal === seat.terminal || other.source === seat.source && other.id === seat.id).length !== 1) { complete = false; continue; }
      const read = await orchidHost.readDispatches(config.dispatchRoot, { keys: [record.dispatchKey] });
      const receipt = read.dispatches[0];
      if (read.degraded || read.dispatches.length !== 1 || !receipt || receipt.runId !== "orchid-" + record.dispatchKey ||
          receipt.source !== seat.source || !orchidHost.matchesNativeRootIdentity(receipt, seat.id, seat.source)) { complete = false; continue; }
      usedReceipts.add(record.dispatchKey);
      // Native Orchid records own the canonical source issue. Restored handles replace placement only.
      const { stop: _stop, teardown: _teardown, claudeStatus: _status, ...provenance } = receipt;
      const dispatch = { ...provenance, issue: record.issue, location: { workspaceId: seat.workspace, paneId: seat.pane } };
      const working = record.phase === "active" && seat.state === "working";
      const idle = record.phase === "active" && ["idle", "done", "blocked"].includes(seat.state);
      roots.set(dispatch.runId, { id: seat.id, running: working || idle ? {
        value: working, reason: null, observedAt: input.now,
        validUntil: new Date(Date.parse(input.now) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
        revision: digest([record.dispatchKey, seat.revision, seat.state]),
      } : { value: null, reason: "measurement_missing", observedAt: null, validUntil: null, revision: null } });
      dispatches.push(dispatch);
      const observation = buildAgentObservations({ dispatches: [dispatch], runs: [], nativeRoots: roots,
        observedAt: input.now, sourceBound: true, dispatchComplete: true, nativeComplete: true, wireFamily }).agents[0];
      if (!observation) { complete = false; continue; }
      if (record.phase === "completed") completedRuns.push({ agentId: observation.agentId, dispatchId: observation.assignment.id });
      const binding = { agentId: observation.agentId, dispatchId: observation.assignment.id, terminalId: seat.terminal, paneId: seat.pane };
      bindings.push(binding);
      try { await input.onBinding?.(receipt, binding); } catch { /* Attachment metadata cannot erase native execution proof. */ }
      const lookup = lookups.find(row => row.terminalId === seat.terminal && row.paneId === seat.pane)!;
      lookups[lookups.indexOf(lookup)] = { ...lookup, outcome: "bound" };
    }
    if (lookups.some(row => row.outcome !== "bound" && row.outcome !== "none")) complete = false;
    const observations = buildAgentObservations({ dispatches, runs: [], nativeRoots: roots,
      observedAt: input.now, sourceBound: true, dispatchComplete: true, nativeComplete: true, wireFamily });
    tree = buildIssueAgentTreeSnapshot({ dispatches, observations, runs: [], wireFamily });
    const terminalAssignments = new Set(completedRuns.map(row => row.dispatchId));
    const issues = tree.issues.filter(issue => input.issueKey === undefined ||
      `${issue.repo.owner.toLowerCase()}/${issue.repo.name.toLowerCase()}#${issue.issueNumber}` === input.issueKey)
      .map(issue => ({ ...issue, dispatches: issue.dispatches.map(group => ({ ...group, agents: group.agents.map(agent =>
        !terminalAssignments.has(agent.dispatchId) ? agent : { ...agent,
          // The fence proves final assignment end, not an outcome or an exact end timestamp.
          liveness: { state: "ended" as const, evidence: "native-outcome" as const, observedAt: input.now, reason: null },
        }) })) }));
    tree = { ...tree, issues, revision: digest({ issues }), complete: tree.complete && complete,
      reason: tree.reason ?? (complete ? null : "binding_unavailable") };
    const decoded = readIssueAgentTreeSnapshot(tree);
    if (!decoded.ok) throw Error();
    tree = decoded.snapshot;
    return finish();
  } catch { complete = false; tree = unavailableNativeTree(input.now); bindings.length = 0; completedRuns.length = 0; return finish(); }
}
