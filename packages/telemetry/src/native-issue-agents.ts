/** Native root census. Extend the join here; liveness never depends on transcript or process history. */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { orchidHost, NATIVE_RUN_BATCH_LIMIT, type NativeRunQuery, type NativeRunRecord } from "@rickylabs/host-orchid";
import { ISSUE_AGENT_TREE_FRESH_MS, MAX_AGENT_OBSERVATIONS, readIssueAgentTreeSnapshot,
  type AgentObservations, type DispatchEvidence, type IssueAgentTreeSnapshot } from "@rickylabs/harness-contracts";
import { buildAgentObservations, type NativeRootObservation } from "./agent-observations.js";
import { projectNativeIssueAgentFacets } from "./native-issue-agents-projection.js";
import type { RunRecord } from "./model.js";
import { resolveNativeOperatorBindings, type OperatorEnvironment } from "./operator-environment.js";
import { publicThreadId } from "./codex-thread-project.js";
import { resolveWireFamily } from "./producer-names.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const handle = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const label = /^(codex|codex-run|claude|agy|opencode|opencode-run)-([1-9][0-9]{0,15})$/;
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
  readonly runs: { readonly generatedAt: string; readonly complete: boolean; readonly dispatches: readonly DispatchEvidence[];
    readonly runs: readonly RunRecord[]; readonly agentObservations: AgentObservations | null };
  readonly threadBindings: { readonly observation: AgentObservations | null;
    readonly bindings: readonly { readonly agentId: string; readonly threadId: string | null }[]; readonly reason: "source_incomplete" | null };
  readonly bindings: readonly Binding[];
  readonly lookups: readonly Lookup[];
  readonly coverage: { readonly complete: boolean };
  readonly runKeys: readonly NativeRunQuery[];
  readonly keySourceAvailable: boolean;
  readonly unseatedRuns: readonly { readonly agentId: string; readonly dispatchId: string }[];
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
  readonly home?: string; readonly limit?: number; readonly partialTrees?: boolean;
  /** Private attachment metadata may reuse the certified receipt; it supplies no execution facts. */
  readonly knownRuns?: readonly NativeRunQuery[];
  readonly onBinding?: (receipt: DispatchEvidence, binding: Readonly<Binding>) => Promise<void>;
}): Promise<NativeIssueAgentRead> {
  let tree = unavailableNativeTree(input.now);
  const bindings: Binding[] = [], lookups: Lookup[] = [];
  const unseatedRuns: { agentId: string; dispatchId: string }[] = [];
  let runKeys: NativeRunQuery[] = [], keySourceAvailable = false;
  const completedRuns: { agentId: string; dispatchId: string }[] = [];
  let complete = true;
  let selectedDispatches: DispatchEvidence[] = [], selectedObservations: AgentObservations | null = null;
  let selectedRuns: readonly RunRecord[] = [];
  const threadBindings: { agentId: string; threadId: string | null }[] = [];
  const finish = (): NativeIssueAgentRead => ({ issueAgentTree: tree,
    runs: { generatedAt: input.now, complete: complete && keySourceAvailable, dispatches: selectedDispatches, runs: selectedRuns, agentObservations: selectedObservations },
    threadBindings: { observation: selectedObservations, bindings: threadBindings.slice(0, 128),
      reason: complete && threadBindings.length <= 128 ? null : "source_incomplete" }, bindings, lookups,
    coverage: { complete }, completedRuns, unseatedRuns, runKeys, keySourceAvailable, rootMetadata: { observedAt: tree.observedAt, validUntil: tree.validUntil, revision: tree.revision,
      issues: tree.issues.map(({ repo, issueNumber, dispatches }) => ({ repo, issueNumber, dispatches })) } });
  try {
    const config = resolveNativeOperatorBindings(input.env), wireFamily = resolveWireFamily(input.env);
    if (!config.dispatchRoot || !config.orchidRunSocket) { complete = false; return finish(); }
    const raw = input.nativeSnapshot;
    if (!object(raw) || !Array.isArray(raw.workspaces) || !Array.isArray(raw.agents)) throw Error();
    // This is a current native census bound, independent of retained receipts. Never select a history prefix.
    const censusOverflow = raw.agents.length > MAX_AGENT_OBSERVATIONS;
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
    const current = new Map<string, NativeRunQuery>();
    const ambiguousKeys = new Set<string>();
    for (const [workspace, workspaceLabel] of workspaces) {
      const match = label.exec(workspaceLabel);
      if (!match || !Number.isSafeInteger(Number(match[2]))) continue;
      if (current.has(match[2]!)) ambiguousKeys.add(match[2]!);
      current.set(match[2]!, { key: match[2]!, label: workspaceLabel });
      if (ambiguous.has(workspace)) ambiguousKeys.add(match[2]!);
    }
    const known = input.knownRuns ?? [];
    if (!Array.isArray(known) || known.length > MAX_AGENT_OBSERVATIONS || new Set(known.map(q => q.key)).size !== known.length ||
        known.some(q => !q || typeof q.label !== "string" || label.exec(q.label)?.[2] !== q.key ||
          !Number.isSafeInteger(Number(q.key)))) throw Error();
    // Coordinates remembered in KV are replay hints, never a running signal. Current labels win capacity.
    // Prioritize reported native work before idle workspace records; this is a source fact, never file age.
    const nativeWorking = (query: NativeRunQuery) => seats.some(seat =>
      workspaces.get(seat.workspace) === query.label && seat.state === "working" && seat.id !== null);
    const all = new Map([...current].sort((a, b) => Number(nativeWorking(b[1])) - Number(nativeWorking(a[1]))));
    for (const query of known) if (!all.has(query.key)) all.set(query.key, query);
    const overflow = censusOverflow || all.size > MAX_AGENT_OBSERVATIONS;
    const selected = [...all.values()].slice(0, MAX_AGENT_OBSERVATIONS);
    if (overflow || ambiguousKeys.size) complete = false;
    for (const seat of seats) {
      const workspaceLabel = workspaces.get(seat.workspace);
      lookups.push({ terminalId: seat.terminal, paneId: seat.pane,
        outcome: label.test(workspaceLabel ?? "") ? "unresolved" : !seat.id ? "not_looked_up"
          : workspaceLabel === undefined ? "unverified" : "none" });
    }
    // Hints may be retained during source failure; they never assert a binding or execution state.
    runKeys = selected;
    const records: NativeRunRecord[] = [], absent = new Set<string>();
    if (selected.length === 0) {
      const health = await orchidHost.lookupNativeRuns(config.orchidRunSocket, []);
      if (!health.complete) complete = false;
      keySourceAvailable = health.complete;
    }
    for (let at = 0; at < selected.length; at += NATIVE_RUN_BATCH_LIMIT) {
      const read = await orchidHost.lookupNativeRuns(config.orchidRunSocket, selected.slice(at, at + NATIVE_RUN_BATCH_LIMIT));
      if (!read.complete) throw Error();
      if (read.missing.length) complete = false;
      for (const row of read.missing) if (row.reason === "run_not_found") absent.add(row.key);
      records.push(...read.records);
      keySourceAvailable = true;
    }
    runKeys = selected.filter(q => current.has(q.key) || !absent.has(q.key));
    const dispatches: DispatchEvidence[] = [], metadataDispatches: DispatchEvidence[] = [], roots = new Map<string, NativeRootObservation>();
    // Each batch validates its private root once, rather than walking Git ancestors for each run.
    const receiptByKey = new Map<string, DispatchEvidence>();
    const keys = [...new Set(records.map(record => record.dispatchKey))];
    for (let at = 0; at < keys.length; at += NATIVE_RUN_BATCH_LIMIT) {
      const read = await orchidHost.readDispatches(config.dispatchRoot, { keys: keys.slice(at, at + NATIVE_RUN_BATCH_LIMIT) });
      if (read.degraded) complete = false;
      for (const receipt of read.dispatches) receiptByKey.set(receipt.runId.slice("orchid-".length), receipt);
    }
    const duplicatedReceipts = new Set(records.filter((row, i) => records.some((other, j) =>
      i !== j && row.dispatchKey === other.dispatchKey)).map(row => row.dispatchKey));
    for (const record of records) {
      const query = all.get(record.key)!;
      const recordedAgent = label.exec(query.label)![1]!;
      // Native run tokens identify the launch; Herdr and receipts use the canonical vendor.
      const source = (recordedAgent === "codex-run" ? "codex" :
        recordedAgent === "opencode-run" ? "opencode" : recordedAgent) as Seat["source"];
      const matchingSeats = seats.filter(seat => workspaces.get(seat.workspace) === query.label);
      const candidate = matchingSeats.length === 1 ? matchingSeats[0] : undefined;
      const seat = candidate && !ambiguousKeys.has(record.key) && candidate.id === record.nativeSessionId && candidate.source === source &&
        seats.filter(other => other.pane === candidate.pane || other.terminal === candidate.terminal ||
          other.source === source && other.id === candidate.id).length === 1 ? candidate : undefined;
      if (duplicatedReceipts.has(record.dispatchKey)) { complete = false; continue; }
      // An occupied but conflicting seat is never attached. A prior coordinate may retain its run as Unknown.
      if (!seat && record.phase === "active" && matchingSeats.length > 0 && !known.some(q => q.key === record.key)) {
        complete = false; continue;
      }
      const receipt = receiptByKey.get(record.dispatchKey);
      if (!receipt || receipt.runId !== "orchid-" + record.dispatchKey ||
          receipt.source !== source || !orchidHost.matchesNativeRootIdentity(receipt, record.nativeSessionId, source)) { complete = false; continue; }
      // Native records own canonical issue identity. Native final phase carries no invented success or end time.
      const { claudeStatus: _status, stop: _stop, teardown: _teardown, ...provenance } = receipt;
      const dispatch: DispatchEvidence = { ...provenance, issue: record.issue,
        ...(seat ? { location: { workspaceId: seat.workspace, paneId: seat.pane } } : {}) };
      const working = record.phase === "active" && seat?.state === "working";
      const idle = record.phase === "active" && seat !== undefined && ["idle", "done", "blocked"].includes(seat.state);
      roots.set(dispatch.runId, { id: record.nativeSessionId, completed: record.phase === "completed", running: working || idle ? {
        value: working, reason: null, observedAt: input.now,
        validUntil: new Date(Date.parse(input.now) + ISSUE_AGENT_TREE_FRESH_MS).toISOString(),
        revision: digest([record.dispatchKey, seat?.revision, seat?.state]),
      } : { value: null, reason: "measurement_missing", observedAt: null, validUntil: null, revision: null } });
      dispatches.push(dispatch); metadataDispatches.push(receipt);
      const observation = buildAgentObservations({ dispatches: [dispatch], runs: [], nativeRoots: roots,
        observedAt: input.now, sourceBound: true, dispatchComplete: true, nativeComplete: true, wireFamily }).agents[0];
      if (!observation) { complete = false; continue; }
      const identity = { agentId: observation.agentId, dispatchId: observation.assignment.id };
      threadBindings.push({ agentId: observation.agentId, threadId: source === "codex" ? publicThreadId(record.nativeSessionId) : null });
      if (record.phase === "completed") completedRuns.push(identity);
      if (!seat) {
        unseatedRuns.push(identity);
        if (record.phase === "active") complete = false;
        continue;
      }
      const binding = { ...identity, terminalId: seat.terminal, paneId: seat.pane };
      bindings.push(binding);
      try { await input.onBinding?.(receipt, binding); } catch { /* Attachment metadata cannot erase native execution proof. */ }
      const lookup = lookups.find(row => row.terminalId === seat.terminal && row.paneId === seat.pane)!;
      lookups[lookups.indexOf(lookup)] = { ...lookup, outcome: "bound" };
    }
    if (lookups.some(row => row.outcome !== "bound" && row.outcome !== "none")) complete = false;
    const projection = await projectNativeIssueAgentFacets({ ...input, dispatches, metadataDispatches, roots, complete, overflow });
    tree = projection.tree;
    const decoded = readIssueAgentTreeSnapshot(tree);
    if (!decoded.ok) throw Error();
    tree = decoded.snapshot;
    selectedDispatches = dispatches; selectedObservations = projection.observations; selectedRuns = projection.runs;
    return finish();
  } catch {
    complete = false; tree = unavailableNativeTree(input.now);
    bindings.length = 0; completedRuns.length = 0; unseatedRuns.length = 0;
    keySourceAvailable = false; threadBindings.length = 0;
    selectedDispatches = []; selectedObservations = null; selectedRuns = [];
    // Independent admission evidence survives a failed native read; execution never falls back.
    try {
      tree = (await projectNativeIssueAgentFacets({ ...input, dispatches: [], metadataDispatches: [],
        roots: new Map(), complete: false, overflow: false, unavailableReason: "source_unavailable" })).tree;
    } catch { /* Invalid configuration cannot certify any independent source. */ }
    return finish();
  }
}
