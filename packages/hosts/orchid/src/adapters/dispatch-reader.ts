/** Read the dispatcher's existing private matrix reservations; no collection or native-session guesses. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { compareRouteIdentity, projectRouteIdentity, openCodeModelSyntax, openCodeProvider, ISSUE_LAUNCH_BLOCK_REASONS,
  ISSUE_LAUNCH_REFUSAL_REASONS, ORCHID_OBSERVER_REASON, ORCHID_ROUTE_FIELDS, unavailableOrchidRouteReasons,
  type OrchidRouteObservedReasons, type AgentBudget, type AgentRoutePolicy, type AgentLaunchRevision, type DispatchEvidence,
  type OrchidDispatchRead, type OrchidDispatchUnavailableReason, type OrchidLaunchState } from "@rickylabs/harness-contracts";
import { object } from "../domain/receipt-shape.js";
import { readOrchidNativeBinding, readOrchidLaunchBinding } from "./native-binding-reader.js";
import { readOrchidStopObservation } from "./stop-observation.js";
import { readOrchidTeardownObservation } from "./teardown-observation.js";
import { readOrchidClaudeStatus } from "./claude-status.js";

const hash = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const label = (value: unknown): value is string => typeof value === "string" &&
  value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
/** Receipt reasons are public only after exact source, route and fixed-text validation. */
async function readRouteObservedReasons(record: string, source: string, model: string, dispatchMatrixSource: unknown): Promise<{
  readonly reasons: OrchidRouteObservedReasons; readonly policy: AgentRoutePolicy; readonly matrixRevision: string | null;
}> {
  const unavailable = { reasons: unavailableOrchidRouteReasons(), policy: {
    value: null, digest: null, source: "unavailable", reason: "source_not_bound",
  } as const, matrixRevision: null };
  try {
    const file = await open(join(record, "receipt.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let raw: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size > 16_384) return unavailable;
      const bytes = Buffer.alloc(16_385);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 16_384) return unavailable;
      raw = bytes.subarray(0, bytesRead);
    } finally { await file.close(); }
    const receipt = object(JSON.parse(raw.toString("utf8")));
    const requested = object(receipt?.requested);
    const observed = object(receipt?.observed);
    const selected = object(object(receipt?.resolution)?.selected);
    if (receipt?.schemaVersion !== 1 || requested === null || observed === null ||
        requested.transport !== source || requested.model !== model || selected?.physicalModel !== model ||
        typeof requested.effort !== "string" || requested.effort.length > 128 ||
        Object.keys(observed).sort().join(",") !== [...ORCHID_ROUTE_FIELDS].sort().join(",")) return unavailable;
    const result = {} as Record<typeof ORCHID_ROUTE_FIELDS[number], OrchidRouteObservedReasons[typeof ORCHID_ROUTE_FIELDS[number]]>;
    for (const field of ORCHID_ROUTE_FIELDS) {
      const row = object(observed[field]);
      if (row === null || Object.keys(row).sort().join(",") !== "reason,reasonCode,status" ||
          row.status !== "unknown" || row.reasonCode !== "observer-unavailable" || row.reason !== ORCHID_OBSERVER_REASON) return unavailable;
      result[field] = { status: "unknown", reasonCode: "observer-unavailable", reason: ORCHID_OBSERVER_REASON };
    }
    const resolution = object(receipt.resolution);
    const digest = resolution?.digest;
    // Both absent is a historical NetScript writer. New Harness writers must
    // bind the same repository in dispatch.json and the immutable policy receipt.
    const policyName = dispatchMatrixSource === undefined && resolution?.sourceRepository === undefined
      ? "netscript-matrix"
      : dispatchMatrixSource === "rickylabs/harness" && resolution?.sourceRepository === "rickylabs/harness"
        ? "harness-matrix" : null;
    return { reasons: result as OrchidRouteObservedReasons,
      policy: policyName !== null && typeof digest === "string" && hash.test(digest)
        ? { value: policyName, digest, source: "dispatch", reason: null }
        : { value: null, digest: null, source: "unavailable", reason: "binding_invalid" },
      matrixRevision: policyName !== null && typeof digest === "string" && hash.test(digest) &&
        typeof resolution?.sourceRevision === "string" && commit.test(resolution.sourceRevision)
        ? resolution.sourceRevision : null };
  } catch { return unavailable; }
}
const launchFile = /^launch-[a-f0-9]{64}\.json$/;
const assignment = /^assignment_[a-f0-9]{64}$/;
const stamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
async function readLaunchState(root: string, name: string): Promise<OrchidLaunchState> {
  const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.size > 4096) throw new Error();
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 4096) throw new Error();
    const row = object(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
    const issue = object(row?.issue);
    if (row === null || Object.keys(row).sort().join(",") !== "dispatchId,issue,observedAt,reasonCode,schemaVersion,state" ||
        issue === null || Object.keys(issue).sort().join(",") !== "number,repo" ||
        typeof issue.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(issue.repo) ||
        !Number.isSafeInteger(issue.number) || (issue.number as number) < 1 ||
        typeof row.dispatchId !== "string" || !assignment.test(row.dispatchId) || !stamp(row.observedAt)) throw new Error();
    const common = { issue: { repo: issue.repo, number: issue.number as number },
      dispatchId: row.dispatchId, observedAt: row.observedAt };
    if (row.schemaVersion === 2 && row.state === "blocked" &&
        ISSUE_LAUNCH_BLOCK_REASONS.includes(row.reasonCode as typeof ISSUE_LAUNCH_BLOCK_REASONS[number])) {
      return { ...common, state: "blocked", reasonCode: row.reasonCode as typeof ISSUE_LAUNCH_BLOCK_REASONS[number] };
    }
    if (row.schemaVersion !== 1) throw new Error();
    if (row.state === "refused" &&
        ISSUE_LAUNCH_REFUSAL_REASONS.includes(row.reasonCode as typeof ISSUE_LAUNCH_REFUSAL_REASONS[number])) {
      return { ...common, state: "refused", reasonCode: row.reasonCode as typeof ISSUE_LAUNCH_REFUSAL_REASONS[number] };
    }
    if ((row.state === "launching" || row.state === "launched") && row.reasonCode === null) {
      return { ...common, state: row.state, reasonCode: null };
    }
    throw new Error();
  } finally { await file.close(); }
}

/** Root diagnostics echo only the configured root, never a descriptor path, native identity, or raw receipt. */
export async function readOrchidDispatches(root: string | undefined): Promise<OrchidDispatchRead> {
  if (root === undefined) return { root, reason: null, dispatches: [], launchStates: [], notes: [], degraded: false };
  const dispatches: DispatchEvidence[] = [];
  const launchStates: OrchidLaunchState[] = [];
  const notes = new Set<string>();
  let reason: OrchidDispatchUnavailableReason | null = null;
  try {
    if (!isAbsolute(root)) reason = "relative_path";
    if (reason !== null) throw new Error();
    let rootStat;
    try { rootStat = await lstat(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") reason = "missing";
      throw error;
    }
    if (rootStat.isSymbolicLink()) reason = "symlink";
    else if (!rootStat.isDirectory()) reason = "not_directory";
    else if ((rootStat.mode & 0o7777) !== 0o700) reason = "wrong_mode";
    else if (await realpath(root) !== resolve(root)) reason = "symlink";
    if (reason !== null) throw new Error();
    // The writer also refuses roots within a Git checkout. Recheck at the read boundary.
    for (let dir = root;; dir = dirname(dir)) {
      try { await lstat(join(dir, ".git")); reason = "git_ancestor"; throw new Error("tracked"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (dirname(dir) === dir) break;
    }
    const names = await readdir(root);
    const launches = names.filter(name => launchFile.test(name)).sort();
    if (launches.length > 1000) notes.add("orchid-dispatch: scan_limit");
    const seenLaunchIssues = new Set<string>();
    const ambiguousLaunchIssues = new Set<string>();
    for (const name of launches.slice(0, 1000)) {
      try {
        const state = await readLaunchState(root, name);
        const key = `${state.issue.repo.toLowerCase()}#${state.issue.number}`;
        if (seenLaunchIssues.has(key)) { ambiguousLaunchIssues.add(key); notes.add("orchid-dispatch: binding_unavailable"); }
        seenLaunchIssues.add(key);
        launchStates.push(state);
      } catch { notes.add("orchid-dispatch: binding_unavailable"); }
    }
    if (ambiguousLaunchIssues.size > 0) {
      for (let i = launchStates.length - 1; i >= 0; i--) {
        const row = launchStates[i]!;
        if (ambiguousLaunchIssues.has(`${row.issue.repo.toLowerCase()}#${row.issue.number}`)) launchStates.splice(i, 1);
      }
    }
    const entries = names.filter(name => hash.test(name)).sort();
    if (entries.length > 1000) notes.add("orchid-dispatch: scan_limit");
    for (const key of entries.slice(0, 1000)) {
      try {
        const record = join(root, key, "record");
        for (const dir of [join(root, key), record]) {
          const stat = await lstat(dir);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error();
        }
        let file;
        try { file = await open(join(record, "dispatch.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch (error) {
          // A reservation predating this hook has no dispatch binding, not an inferred one.
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        let input: Record<string, unknown> | null;
        let revision: string;
        let sourceModifiedAt: string;
        try {
          const stat = await file.stat();
          sourceModifiedAt = stat.mtime.toISOString();
          if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) !== 0) throw new Error();
          const bytes = Buffer.alloc(16_385);
          const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
          if (bytesRead > 16_384) throw new Error();
          const raw = bytes.subarray(0, bytesRead);
          revision = createHash("sha256").update(raw).digest("hex");
          input = object(JSON.parse(raw.toString("utf8")));
        } finally { await file.close(); }
        if (input === null || input.schemaVersion !== 1 || input.runId !== "orchid-" + key) throw new Error();
        const issue = object(input.issue);
        if (issue === null || typeof issue.repo !== "string" || issue.repo.length > 256 ||
            !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(issue.repo) ||
            !Number.isSafeInteger(issue.number) || (issue.number as number) < 1 || input.parentRunId !== null) throw new Error();
        // Top-level inbox dispatches have no spawning agent. Native children are linked by the existing readers.
        if (input.state === "reserved" && input.location === null) continue;
        if (!["launching", "dispatched", "uncertain"].includes(input.state as string)) throw new Error();
        const location = object(input.location);
        // Failed registration can return before a workspace exists. Keep this
        // validated uncertain receipt issue-local, without inventing a location
        // or poisoning unrelated reads. Running receipts still require handles.
        const unlocatedFailure = input.state === "uncertain" && input.location === null;
        if (!unlocatedFailure && (location === null || !label(location.paneId) || !label(location.workspaceId))) throw new Error();
        const validModel = input.source === "opencode"
          ? openCodeProvider(input.provider) && openCodeModelSyntax(input.model, input.provider)
          : typeof input.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(input.model) && !input.model.includes("..");
        if (!label(input.provider) || !validModel || !label(input.effort) || !["codex", "claude", "agy", "opencode"].includes(input.source as string)) throw new Error();
        // Transport is not router. No native session or observed route can be established from a pane id.
        const route = projectRouteIdentity(compareRouteIdentity(
          { provider: input.provider, model: input.model, effort: input.effort, cwd: null },
          { provider: null, model: null, effort: null, cwd: null },
          input.source === "opencode" ? "opencode" : undefined,
        ));
        const timestamp = input.observedAt ?? sourceModifiedAt;
        const at = typeof timestamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) &&
          Number.isFinite(Date.parse(timestamp)) && new Date(timestamp).toISOString() === timestamp ? timestamp : undefined;
        if (at === undefined) throw new Error();
        const receipt = await readRouteObservedReasons(record, input.source as string, input.model as string, input.matrixSource);
        const launch = await readOrchidLaunchBinding(record, key, input.host, input.profileRevision, revision);
        const oldWriter = !Object.hasOwn(input, "profileRevision") && !Object.hasOwn(input, "matrixRevision");
        const pin = (value: string | null, reason: "source_not_bound" | "binding_invalid"): AgentLaunchRevision => value === null
          ? { value: null, scope: "root-dispatch", source: "unavailable", reason }
          : { value, scope: "root-dispatch", source: "dispatch", reason: null };
        const unavailableReason = oldWriter ? "source_not_bound" : "binding_invalid";
        const profileRevision = pin(launch.profileRevision, unavailableReason);
        const matrixRevision = pin(typeof input.matrixRevision === "string" && commit.test(input.matrixRevision) &&
          receipt.matrixRevision === input.matrixRevision ? input.matrixRevision : null, unavailableReason);
        // Old writers have neither field. New writers must supply a bound, nonnegative limit and its
        // source together. A malformed budget never becomes an invented route default.
        let budget: AgentBudget = { tokenLimit: null, source: "unavailable", reason: "source_not_bound" };
        if (Object.hasOwn(input, "tokenBudget") || Object.hasOwn(input, "budgetSource")) {
          if (input.tokenBudget === null && input.budgetSource === "unset") budget = { tokenLimit: null, source: "unavailable", reason: "source_not_bound" };
          else if (typeof input.tokenBudget === "number" && Number.isSafeInteger(input.tokenBudget) && input.tokenBudget >= 0 &&
            (input.budgetSource === "issue" || input.budgetSource === "route")) {
            budget = { tokenLimit: input.tokenBudget, source: input.budgetSource === "issue" ? "issue-override" : "route-default", reason: null };
          } // Invalid budget metadata withholds only the budget, not the dispatch tree.
        }
        const dispatch: DispatchEvidence = { observedAt: at, revision, linkageBasis: "dispatcher-confirmed", runId: input.runId as string, external: null,
          host: launch.host, profileRevision, matrixRevision,
          source: input.source === "codex" || input.source === "claude" || input.source === "agy" || input.source === "opencode" ? input.source : null,
          harness: input.source as "codex" | "claude" | "agy" | "opencode", budget,
          router: input.source === "codex" || input.source === "claude" || input.source === "agy" || input.source === "opencode"
            ? { value: "direct", source: "dispatch", reason: null }
            : { value: null, source: "unavailable", reason: "source_not_bound" },
          routePolicy: receipt.policy,
          route, routeObservedReasons: receipt.reasons, issue: { repo: issue.repo, number: issue.number as number }, parentRunId: null,
          location: location === null ? null : { paneId: location.paneId as string, workspaceId: location.workspaceId as string },
          dispatchState: input.state as "launching" | "dispatched" | "uncertain" };
        const stop = location === null ? undefined : await readOrchidStopObservation(root, record, { runId: dispatch.runId,
          repository: issue.repo as string, issueNumber: issue.number as number,
          host: dispatch.host ?? null, paneId: location.paneId as string, workspaceId: location.workspaceId as string });
        const teardown = location === null ? undefined : await readOrchidTeardownObservation(record, { runId: dispatch.runId,
          repository: issue.repo as string, issueNumber: issue.number as number,
          host: dispatch.host ?? null, paneId: location.paneId as string, workspaceId: location.workspaceId as string });
        // Bind the final object: native identity is held in a private WeakMap.
        const boundDispatch = { ...dispatch, ...(stop === undefined ? {} : { stop }),
          ...(teardown === undefined ? {} : { teardown }) };
        await readOrchidNativeBinding(record, key, boundDispatch);
        const claudeStatus = location === null ? null : await readOrchidClaudeStatus(record, boundDispatch);
        if (claudeStatus !== null) Object.assign(boundDispatch, { claudeStatus });
        dispatches.push(boundDispatch);
      } catch { notes.add("orchid-dispatch: binding_unavailable"); }
    }
  } catch { notes.add("orchid-dispatch: source_unavailable"); }
  return { root, reason, dispatches, launchStates, notes: [...notes], degraded: notes.size > 0 };
}
