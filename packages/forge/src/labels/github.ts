/**
 * GitHub transport, chosen by detection rather than assumption.
 *
 * Two environments this has to work in: a shell where `gh` is installed and authenticated, and one
 * where it is not on PATH at all (the agent containers are the second kind). So the transport is
 * probed, never assumed, and the chosen kind is reported so a run's evidence says how it talked to
 * GitHub.
 */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface ExistingLabel {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface Milestone {
  readonly title: string;
  readonly state: string;
}

export interface IssueRef {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
}

export type TransportKind = "gh" | "rest";

export interface GitHubTransport {
  readonly kind: TransportKind;
  /** How this transport was authenticated, for the run record. Never contains the credential. */
  readonly authNote: string;
  listLabels(repo: string): Promise<readonly ExistingLabel[]>;
  createLabel(repo: string, label: ExistingLabel): Promise<void>;
  updateLabel(repo: string, name: string, label: ExistingLabel): Promise<void>;
  listMilestones(repo: string): Promise<readonly Milestone[]>;
  searchIssues(repo: string, query: string): Promise<readonly IssueRef[]>;
}

export interface TransportUnavailable {
  readonly kind: "none";
  readonly reasons: readonly string[];
}

export type TransportProbe = GitHubTransport | TransportUnavailable;

export const isAvailable = (p: TransportProbe): p is GitHubTransport => p.kind !== "none";

interface ApiLabel {
  name: string;
  color: string;
  description: string | null;
}

interface ApiMilestone {
  title: string;
  state: string;
}

interface ApiIssue {
  number: number;
  title: string;
  labels: Array<{ name: string } | string>;
}

const labelNames = (labels: ApiIssue["labels"]): readonly string[] =>
  labels.map((l) => (typeof l === "string" ? l : l.name));

const toLabel = (l: ApiLabel): ExistingLabel => ({
  name: l.name,
  color: l.color.toLowerCase(),
  description: l.description ?? "",
});

// ── gh transport ─────────────────────────────────────────────────────────────

async function ghJson<T>(args: readonly string[]): Promise<T> {
  const { stdout } = await run("gh", [...args], { maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

function ghTransport(authNote: string): GitHubTransport {
  return {
    kind: "gh",
    authNote,
    async listLabels(repo) {
      const raw = await ghJson<ApiLabel[]>(["api", "--paginate", `repos/${repo}/labels?per_page=100`]);
      return raw.map(toLabel);
    },
    async createLabel(repo, label) {
      await run("gh", [
        "api", "--method", "POST", `repos/${repo}/labels`,
        "-f", `name=${label.name}`,
        "-f", `color=${label.color}`,
        "-f", `description=${label.description}`,
      ]);
    },
    async updateLabel(repo, name, label) {
      await run("gh", [
        "api", "--method", "PATCH", `repos/${repo}/labels/${encodeURIComponent(name)}`,
        "-f", `new_name=${label.name}`,
        "-f", `color=${label.color}`,
        "-f", `description=${label.description}`,
      ]);
    },
    async listMilestones(repo) {
      const raw = await ghJson<ApiMilestone[]>([
        "api", "--paginate", `repos/${repo}/milestones?state=all&per_page=100`,
      ]);
      return raw.map((m) => ({ title: m.title, state: m.state }));
    },
    async searchIssues(repo, query) {
      const raw = await ghJson<{ items: ApiIssue[] }>([
        "api", `search/issues?q=${encodeURIComponent(`repo:${repo} ${query}`)}&per_page=100`,
      ]);
      return raw.items.map((i) => ({ number: i.number, title: i.title, labels: labelNames(i.labels) }));
    },
  };
}

// ── REST transport ───────────────────────────────────────────────────────────

function restTransport(token: string, authNote: string): GitHubTransport {
  const base = process.env["GITHUB_API_URL"] ?? "https://api.github.com";
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "dsh-forge-labels",
  };

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.body ? { "content-type": "application/json" } : {}) },
    });
    if (!res.ok) {
      // The body can echo the request; it never contains the token, which lives only in headers.
      throw new Error(`GitHub ${init?.method ?? "GET"} ${path} -> ${res.status} ${res.statusText}`);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async function paginate<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const sep = path.includes("?") ? "&" : "?";
      const batch = await req<T[]>(`${path}${sep}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  return {
    kind: "rest",
    authNote,
    async listLabels(repo) {
      return (await paginate<ApiLabel>(`/repos/${repo}/labels`)).map(toLabel);
    },
    async createLabel(repo, label) {
      await req(`/repos/${repo}/labels`, { method: "POST", body: JSON.stringify(label) });
    },
    async updateLabel(repo, name, label) {
      await req(`/repos/${repo}/labels/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify({ new_name: label.name, color: label.color, description: label.description }),
      });
    },
    async listMilestones(repo) {
      return (await paginate<ApiMilestone>(`/repos/${repo}/milestones?state=all`))
        .map((m) => ({ title: m.title, state: m.state }));
    },
    async searchIssues(repo, query) {
      const raw = await req<{ items: ApiIssue[] }>(
        `/search/issues?q=${encodeURIComponent(`repo:${repo} ${query}`)}&per_page=100`,
      );
      return raw.items.map((i) => ({ number: i.number, title: i.title, labels: labelNames(i.labels) }));
    },
  };
}

// ── probe ────────────────────────────────────────────────────────────────────

/**
 * Prefer `gh` when it is installed *and* authenticated, fall back to a token from the environment,
 * and when neither works say why — both reasons, so the operator fixes the right one.
 */
export async function detectTransport(): Promise<TransportProbe> {
  const reasons: string[] = [];

  try {
    await run("gh", ["auth", "status"], { timeout: 15_000 });
    const { stdout } = await run("gh", ["--version"], { timeout: 15_000 });
    return ghTransport(`gh CLI (${stdout.split("\n")[0]?.trim() ?? "version unknown"})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reasons.push(
      /ENOENT/.test(message)
        ? "gh is not on PATH"
        : `gh is present but not usable: ${message.split("\n")[0] ?? message}`,
    );
  }

  const token = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (token && token.length > 0) return restTransport(token, "REST with GITHUB_TOKEN/GH_TOKEN from the environment");
  reasons.push("no GITHUB_TOKEN or GH_TOKEN in the environment");

  return { kind: "none", reasons };
}

const REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const GITHUB_PROTOCOLS = new Set(["git:", "http:", "https:", "ssh:"]);

/**
 * Read a GitHub repository identity from a Git remote URL without retaining credentials.
 *
 * Git accepts both scheme URLs and an scp-like SSH form. Keep those grammars separate: feeding the
 * latter to `URL` turns its owner into a protocol, while a substring regex can mistake a lookalike
 * host for GitHub. The return value is only the two path segments, never the raw URL or user-info.
 */
export function parseGitHubRepoSlug(remote: string): string | null {
  const text = remote.trim();
  if (text === "") return null;

  let owner: string | undefined;
  let repo: string | undefined;

  // Check this first: `github.com:o/r` is syntactically a URL with protocol `github.com:`, even
  // though Git interprets it as the scp-like form.
  const scp = /^(?:[^@/:\s]+@)?github\.com:([^/?#\s]+)\/([^/?#\s]+?)\/?$/i.exec(text);
  if (scp) {
    owner = scp[1];
    repo = scp[2];
  } else {
    try {
      const url = new URL(text);
      if (!GITHUB_PROTOCOLS.has(url.protocol) || url.hostname.toLowerCase() !== "github.com") return null;
      if (url.search !== "" || url.hash !== "") return null;
      const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
      const match = /^\/([^/]+)\/([^/]+)$/.exec(path);
      if (!match) return null;
      owner = match[1];
      repo = match[2];
    } catch {
      return null;
    }
  }

  repo = repo?.endsWith(".git") ? repo.slice(0, -4) : repo;
  if (!owner || !repo || !REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(repo)) return null;
  return `${owner}/${repo}`;
}

/** The closest directory Git can inspect, including an ancestor of a not-yet-created target. */
async function nearestExistingDirectory(path: string): Promise<string | null> {
  let candidate = resolve(path);
  for (;;) {
    try {
      const entry = await stat(candidate);
      if (entry.isDirectory()) return candidate;
    } catch {
      // Missing, inaccessible and not-a-directory targets all fall back to a parent. At filesystem
      // root there is no evidence to recover, so the caller treats the repository as unknown.
    }
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

/** Resolve `owner/repo` from the enclosing checkout's origin when the caller did not pass one. */
export async function detectRepoSlug(cwd: string): Promise<string | null> {
  try {
    const inspect = await nearestExistingDirectory(cwd);
    if (inspect === null) return null;
    const { stdout } = await run("git", ["remote", "get-url", "origin"], { cwd: inspect, timeout: 15_000 });
    return parseGitHubRepoSlug(stdout);
  } catch {
    return null;
  }
}
