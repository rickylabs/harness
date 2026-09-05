/**
 * The GitHub read adapter — the only part of this package that touches the network.
 *
 * Read-only by construction. The projection never writes to the source of truth; decision 3 makes
 * GitHub authoritative, and a projector that edits what it projects is no longer a projector.
 *
 * This shells out to `gh` rather than speaking REST directly. `gh` already holds the credential,
 * already handles pagination and enterprise hosts, and keeps this package from ever seeing a
 * token — no credential value reaches argv, a log, or a written artifact by way of this file.
 *
 * ## Every failure here is a transport failure
 *
 * The only commands this module issues are reads. There is no such thing as a read that failed
 * because of something the board said, so a non-zero `gh` is always the transport, never the data
 * — rate limits, DNS, a proxy, a repository that does not exist, an expired token. Classifying
 * only the messages we recognised and letting the rest escape meant a network outage surfaced with
 * the exit code the CLI reserves for "the board contradicts itself". Everything is wrapped now,
 * and the underlying message is carried along rather than swallowed.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Completeness, ItemKind, SourceIssue } from "./model.js";

const run = promisify(execFile);

/** Raised when `gh` could not answer. The CLI turns this into advice and its own exit code. */
export class TransportUnavailable extends Error {}

/** Shape `gh` returns for issues and pull requests, before we normalise it. */
interface GhItem {
  number: number;
  title: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  labels?: { name: string }[];
  assignees?: { login: string }[];
  milestone?: { title: string } | null;
  isDraft?: boolean;
  mergedAt?: string | null;
}

const MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Classify a failed `gh` invocation.
 *
 * Total by construction: every input returns a `TransportUnavailable`. The recognised cases exist
 * only to give better advice, never to decide *whether* this is a transport failure — that was the
 * defect. A classifier with a fall-through is one that behaves differently on a network nobody
 * tested against.
 */
export function transportFailure(error: unknown): TransportUnavailable {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT/.test(message)) {
    return new TransportUnavailable("gh is not installed or not on PATH");
  }
  if (/auth|credential|HTTP 401|HTTP 403/i.test(message)) {
    return new TransportUnavailable(`gh is not authenticated: ${message}`);
  }
  return new TransportUnavailable(`gh could not read from GitHub: ${message}`);
}

/**
 * How this module reaches GitHub.
 *
 * Injectable so that the argv it builds, the payloads it accepts, and the completeness it infers
 * are all testable without a network or a credential. The default is the real one.
 */
export type GhRunner = (args: readonly string[], cwd?: string) => Promise<string>;

const gh: GhRunner = async (args, cwd) => {
  try {
    const { stdout } = await run("gh", [...args], {
      maxBuffer: MAX_BUFFER,
      ...(cwd !== undefined ? { cwd } : {}),
    });
    return stdout;
  } catch (error) {
    throw transportFailure(error);
  }
};

function parseItems(json: string, kind: ItemKind): readonly SourceIssue[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    // gh returning something that is not JSON is a transport problem too: it means the process
    // wrote a banner, a proxy error page, or nothing at all where a payload was promised.
    throw new TransportUnavailable(
      `gh returned unparseable output for ${kind}s: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new TransportUnavailable(`gh returned a non-array payload for ${kind}s`);
  }
  return raw.map((item) => normalise(item as GhItem, kind));
}

function normalise(raw: GhItem, kind: ItemKind): SourceIssue {
  const base = {
    number: raw.number,
    title: raw.title,
    state: raw.state.toLowerCase() === "open" ? ("open" as const) : ("closed" as const),
    labels: (raw.labels ?? []).map((l) => l.name),
    url: raw.url,
    assignees: (raw.assignees ?? []).map((a) => a.login),
    milestone: raw.milestone?.title ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    kind,
  };
  if (kind !== "pull-request") return base;
  return {
    ...base,
    draft: raw.isDraft === true,
    // A closed-unmerged PR is not a shipped one, and conflating the two is how a board reports
    // work as landed that was actually abandoned.
    merged: typeof raw.mergedAt === "string" && raw.mergedAt !== "",
  };
}

/** What one fetch saw, and whether it saw all of it. */
export interface FetchResult {
  readonly items: readonly SourceIssue[];
  /**
   * The completeness claim for this fetch.
   *
   * A kind that came back with exactly `limit` rows is reported as capped. That is deliberately a
   * *suspicion* rather than a measurement — `gh` does not say how many it withheld, and a board
   * with exactly 500 issues is indistinguishable from one with 900. Overstating the doubt costs a
   * line of output; understating it means silently showing a prefix, which is the failure this
   * exists to prevent.
   */
  readonly completeness: Completeness;
}

/** Fetch every issue and pull request, open and closed, and normalise them. */
export async function fetchItems(
  repo: string,
  limit = 500,
  runner: GhRunner = gh,
): Promise<FetchResult> {
  const issueFields = "number,title,state,url,createdAt,updatedAt,labels,assignees,milestone";
  const prFields = `${issueFields},isDraft,mergedAt`;

  const [issuesJson, prsJson] = await Promise.all([
    runner(["issue", "list", "--repo", repo, "--state", "all", "--limit", String(limit), "--json", issueFields]),
    runner(["pr", "list", "--repo", repo, "--state", "all", "--limit", String(limit), "--json", prFields]),
  ]);

  const issues = parseItems(issuesJson, "issue");
  const prs = parseItems(prsJson, "pull-request");

  const capped: ItemKind[] = [];
  if (issues.length >= limit) capped.push("issue");
  if (prs.length >= limit) capped.push("pull-request");

  return { items: [...issues, ...prs], completeness: { limit, capped } };
}

/** The `owner/name` slug of the repository in `cwd`, or `null` when it cannot be determined. */
export async function detectRepoSlug(cwd: string, runner: GhRunner = gh): Promise<string | null> {
  try {
    const stdout = await runner(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
    const slug = stdout.trim();
    return slug === "" ? null : slug;
  } catch {
    return null;
  }
}
