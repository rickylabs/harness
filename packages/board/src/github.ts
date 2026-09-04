/**
 * The GitHub read adapter — the only part of this package that touches the network.
 *
 * Read-only by construction. The projection never writes to the source of truth; decision 3 makes
 * GitHub authoritative, and a projector that edits what it projects is no longer a projector.
 *
 * This shells out to `gh` rather than speaking REST directly. `gh` already holds the credential,
 * already handles pagination and enterprise hosts, and keeps this package from ever seeing a
 * token — no credential value reaches argv, a log, or a written artifact by way of this file.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SourceIssue } from "./model.js";

const run = promisify(execFile);

/** Raised when `gh` is absent or unauthenticated, so the CLI can exit with advice instead of a stack. */
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

async function gh(args: readonly string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run("gh", [...args], {
      maxBuffer: MAX_BUFFER,
      ...(cwd !== undefined ? { cwd } : {}),
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT/.test(message)) {
      throw new TransportUnavailable("gh is not installed or not on PATH");
    }
    if (/auth|credential|HTTP 401|HTTP 403/i.test(message)) {
      throw new TransportUnavailable(`gh is not authenticated: ${message}`);
    }
    throw error;
  }
}

function normalise(raw: GhItem, kind: SourceIssue["kind"]): SourceIssue {
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

/** Fetch every issue and pull request, open and closed, and normalise them. */
export async function fetchItems(repo: string, limit = 500): Promise<readonly SourceIssue[]> {
  const issueFields = "number,title,state,url,createdAt,updatedAt,labels,assignees,milestone";
  const prFields = `${issueFields},isDraft,mergedAt`;

  const [issuesJson, prsJson] = await Promise.all([
    gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", String(limit), "--json", issueFields]),
    gh(["pr", "list", "--repo", repo, "--state", "all", "--limit", String(limit), "--json", prFields]),
  ]);

  const issues = (JSON.parse(issuesJson) as GhItem[]).map((raw) => normalise(raw, "issue"));
  const prs = (JSON.parse(prsJson) as GhItem[]).map((raw) => normalise(raw, "pull-request"));
  return [...issues, ...prs];
}

/** The `owner/name` slug of the repository in `cwd`, or `null` when it cannot be determined. */
export async function detectRepoSlug(cwd: string): Promise<string | null> {
  try {
    const stdout = await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], cwd);
    const slug = stdout.trim();
    return slug === "" ? null : slug;
  } catch {
    return null;
  }
}
