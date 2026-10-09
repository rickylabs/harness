/**
 * Test support for the OpenCode issue reader: the recorded `opencode serve` 1.18.35 session
 * (`packages/providers/opencode/tests/fixtures/recorded-session.json`, provenance inside) served through
 * the real `createSdkSessionReader` over a fake `fetch`, and synthetic Orchid receipts that bind it.
 * Not a test file. No socket is opened and no native store is read.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkSessionReader } from "@rickylabs/provider-opencode";
import { collectIssueAgentTree, type IssueAgentFeedOptions, type OpenCodeServerBinding } from "../issue-agent-feed-cli.js";
import { OPERATOR_ENV } from "../operator-environment.js";

type Reply = { status: number; body: unknown };
export interface Recording {
  readonly rootID: string; readonly childID: string; readonly unknownID: string;
  readonly replies: Record<string, Reply>; readonly events: readonly unknown[];
}
// From dist/fixtures/ to the provider's source tree: the provider owns the wire recording.
export const recording = JSON.parse(readFileSync(new URL("../../../providers/opencode/tests/fixtures/recorded-session.json",
  import.meta.url), "utf8")) as Recording;
export type Entry = { info: Record<string, any>; parts: Record<string, any>[] };
export const messagesOf = (replies: Record<string, Reply>, id: string) => replies[`/session/${id}/message`]!.body as Entry[];
export const sessionOf = (replies: Record<string, Reply>, id: string) => replies[`/session/${id}`]!.body as Record<string, any>;

const root = sessionOf(recording.replies, recording.rootID), child = sessionOf(recording.replies, recording.childID);
/** After every recorded clock; the dispatch was observed just before the root session began. */
export const nowMs = Math.max(root.time.updated, child.time.updated) + 60_000;
export const now = new Date(nowMs).toISOString();
export const dispatchedAt = new Date(root.time.created - 1_000).toISOString();
export const provider = "opencode", qualified = "opencode/big-pickle";

/** A server answering from a private copy of the recording; `hook` runs before each reply. */
export function server(hook: (path: string) => void | Promise<void> = () => undefined) {
  const replies = structuredClone(recording.replies);
  const requests: string[] = [];
  const fetch = (async (request: Request): Promise<Response> => {
    if (request.signal.aborted) throw request.signal.reason;
    const url = new URL(request.url);
    requests.push(url.pathname + url.search);
    await hook(url.pathname);
    const reply = replies[url.pathname] ?? { status: 404, body: { name: "NotFoundError", data: { message: "Session not found" } } };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const binding: OpenCodeServerBinding = { reads: createSdkSessionReader({ baseUrl: "http://opencode.example.invalid", fetch }) };
  return { replies, requests, binding };
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
