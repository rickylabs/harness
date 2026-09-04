/**
 * GitHub transport, chosen by detection rather than assumption.
 *
 * Two environments this has to work in: a shell where `gh` is installed and authenticated, and one
 * where it is not on PATH at all (the agent containers are the second kind). So the transport is
 * probed, never assumed, and the chosen kind is reported so a run's evidence says how it talked to
 * GitHub.
 */

import { execFile } from "node:child_process";
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

/** Resolve `owner/repo` from git remotes when the caller did not pass one. */
export async function detectRepoSlug(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["remote", "get-url", "origin"], { cwd, timeout: 15_000 });
    const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?\s*$/.exec(stdout);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}
