/**
 * Test support for the OpenCode issue reader: the provider's recorded `opencode serve` 1.18.35 session
 * (`@rickylabs/provider-opencode/test-fixtures`, provenance inside; its token counters are synthetic)
 * served through a fake of telemetry's own server port, and synthetic Orchid receipts that bind it.
 * Not a test file. No SDK client, no socket and no native store: the adapter is the provider's to
 * test, and the composition through it is `tests/parity`'s.
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeReadBounds, NativeReadOutcome } from "@rickylabs/harness-contracts";
import { recording } from "@rickylabs/provider-opencode/test-fixtures";
import { collectIssueAgentTree, type IssueAgentFeedOptions, type OpenCodeServerBinding } from "../issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "../operator-environment.js";

export { recording };
type Reply = { status: number; body: unknown };
export type Entry = { info: Record<string, any>; parts: Record<string, any>[] };
export const messagesOf = (replies: Record<string, Reply>, id: string) => replies[`/session/${id}/message`]!.body as Entry[];
export const sessionOf = (replies: Record<string, Reply>, id: string) => replies[`/session/${id}`]!.body as Record<string, any>;

const root = sessionOf(recording.replies, recording.rootID), child = sessionOf(recording.replies, recording.childID);
/** After every recorded clock; the dispatch was observed just before the root session began. */
export const nowMs = Math.max(root.time.updated, child.time.updated) + 60_000;
export const now = new Date(nowMs).toISOString();
export const dispatchedAt = new Date(root.time.created - 1_000).toISOString();
export const provider = "opencode", qualified = "opencode/big-pickle";

/**
 * Telemetry's server port answering from a private copy of the recording, with the outcome words and
 * byte accounting the port defines: the server's `404` is `missing`, a reply over the caller's bound is
 * `oversized`, any other failure `unavailable`, and `messages` returns the latest `limit`, as the
 * server does. `hook` runs before each reply with the read's own signal.
 */
export function server(hook: (path: string, signal: AbortSignal) => void | Promise<void> = () => undefined) {
  const replies = structuredClone(recording.replies) as Record<string, Reply>;
  const calls: { path: string; maxBytes: number }[] = [];
  const answer = async (path: string, bounds: NativeReadBounds, limit = Infinity): Promise<NativeReadOutcome> => {
    calls.push({ path, maxBytes: bounds.maxBytes });
    await hook(path, bounds.signal);
    if (bounds.signal.aborted) return { kind: "unavailable", bytes: 0 };
    const reply = replies[path];
    if (reply === undefined) return { kind: "missing", bytes: 0 };
    const body = Array.isArray(reply.body) && Number.isFinite(limit) ? reply.body.slice(-limit) : reply.body;
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes > bounds.maxBytes) return { kind: "oversized", bytes: bounds.maxBytes + 1 };
    if (reply.status === 404) return { kind: "missing", bytes };
    if (reply.status !== 200) return { kind: "unavailable", bytes };
    return { kind: "ok", body: structuredClone(body), bytes };
  };
  const binding: OpenCodeServerBinding = { reads: {
    session: (id, bounds) => answer(`/session/${id}`, bounds),
    children: (id, bounds) => answer(`/session/${id}/children`, bounds),
    messages: (id, limit, bounds) => answer(`/session/${id}/message`, bounds, limit),
    sessionEvents: async () => ({ kind: "closed", detail: "this fixture serves no events" }),
  } };
  return { replies, calls, binding, reads: binding.reads };
}

/** Orchid receipts binding issue #42 to the recorded root; `issue` binds more. */
export async function bound() {
  const base = await mkdtemp(join(tmpdir(), "opencode-issue-"));
  const receipts = join(base, "receipts");
  const issue = async (number: number, id: string | null = recording.rootID, patch: Record<string, unknown> = {}) => {
    const issueId = `fixture-${number}`, brief = "b".repeat(64), repo = "example/project";
    const key = createHash("sha256").update(issueId + "\0" + repo + "\0" + brief).digest("hex");
    const record = join(receipts, key, "record"); await mkdir(record, { recursive: true, mode: 0o700 });
    await writeFile(join(record, "dispatch.json"), JSON.stringify({ schemaVersion: 1, runId: "orchid-" + key,
      issue: { repo, number }, parentRunId: null, source: "opencode", provider, model: qualified, effort: "provider_default",
      state: "dispatched", observedAt: dispatchedAt,
      location: { paneId: "fixture-pane", workspaceId: "fixture-workspace" } }), { mode: 0o600 });
    await writeFile(join(record, "binding.json"), JSON.stringify({ IssueID: issueId, Repo: repo, BriefDigest: brief,
      Route: { transport: "opencode", provider, model: qualified, effort: "provider_default" },
      ...(id === null ? {} : { NativeSessionID: id }), ...patch }), { mode: 0o600 });
    return record;
  };
  const record = await issue(42);
  const collect = (openCode?: OpenCodeServerBinding, extra: Partial<IssueAgentFeedOptions> = {}) => collectIssueAgentTree({
    home: base, limit: 20, now, env: { [OPERATOR_ENV.dispatchRoot]: receipts },
    ...(openCode === undefined ? {} : { openCode }), ...extra });
  const close = () => rm(base, { recursive: true, force: true });
  return { base, receipts, issue, record, collect, close };
}
