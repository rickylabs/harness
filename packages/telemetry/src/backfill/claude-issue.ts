/** Bounded Claude issue scan. The private native ID chooses one root; only its child tree is read. */
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseClaudeTranscript } from "./claude.js";
import { transcriptAsOf } from "./jsonl.js";
import type { RunRecord } from "../model.js";

export interface ClaudeIssueScan {
  readonly runs: readonly RunRecord[];
  readonly bytesRead: number;
  readonly reason: "scan_limit" | "source_unavailable" | null;
}
const SESSION_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const MAX_PROJECT_DIRS = 512;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_CHILD_DIRS = 64;
const MAX_CHILD_DEPTH = 5;
const unavailable = (reason: ClaudeIssueScan["reason"], bytesRead = 0): ClaudeIssueScan =>
  ({ runs: [], bytesRead, reason });

async function entries(path: string, cap: number): Promise<{ name: string; directory: boolean; file: boolean }[] | null> {
  const result: { name: string; directory: boolean; file: boolean }[] = [];
  const handle = await opendir(path);
  try {
    for await (const entry of handle) {
      if (result.length === cap) return null;
      result.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() });
    }
  } finally { await handle.close().catch(() => {}); }
  return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

async function readBounded(path: string, maxBytes: number): Promise<string | null> {
  if (maxBytes <= 0) return null;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const bytes = Buffer.allocUnsafe(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await handle.read(bytes, size, bytes.length - size, size);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    return size > maxBytes ? null : bytes.subarray(0, size).toString("utf8");
  } finally { await handle.close(); }
}

/**
 * No repo slug is guessed from a cwd. Each private binding selects at most one root file. With
 * `notAfterMs`, each file is read as it stood at that capture (see `transcriptAsOf`).
 */
export async function scanClaudeIssue(root: string, matchesRoot: (id: string) => boolean,
  limit: number, maxTranscriptBytes: number, maxTotalBytes: number, notAfterMs?: number): Promise<ClaudeIssueScan> {
  let bytesRead = 0;
  try {
    if (!(await lstat(root)).isDirectory()) return unavailable("source_unavailable");
    const projects = await entries(root, MAX_PROJECT_DIRS);
    if (projects === null) return unavailable("scan_limit");
    const candidates: { project: string; id: string; file: string }[] = [];
    let unreadableProjects = 0;
    for (const project of projects) {
      if (!project.directory) continue;
      const projectRoot = join(root, project.name);
      // An unrelated project may be unreadable to this process. A selected root
      // still has to pass the private ID and parsed-file identity checks below.
      const files = await entries(projectRoot, MAX_DIRECTORY_ENTRIES).catch(() => {
        unreadableProjects++;
        return [];
      });
      if (files === null) return unavailable("scan_limit");
      for (const file of files) {
        if (!file.name.endsWith(".jsonl")) continue;
        const id = basename(file.name, ".jsonl");
        if (!SESSION_ID.test(id) || !matchesRoot(id)) continue;
        if (!file.file) return unavailable("source_unavailable");
        if (candidates.some(candidate => candidate.id === id)) return unavailable("source_unavailable");
        candidates.push({ project: projectRoot, id, file: join(projectRoot, file.name) });
        if (candidates.length > limit) return unavailable("scan_limit");
      }
    }
    if (candidates.length === 0) return unavailable(unreadableProjects > 0 ? "source_unavailable" : null);
    const files: { path: string; rootId: string; root: boolean }[] = [];
    let directories = 0;
    for (const selected of candidates) {
      files.push({ path: selected.file, rootId: selected.id, root: true });
      const childRoot = join(selected.project, selected.id, "subagents");
      const childStat = await lstat(childRoot).catch(error => {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      });
      if (childStat === null) continue;
      if (!childStat.isDirectory()) return unavailable("source_unavailable");
      const walk = async (dir: string, depth: number): Promise<ClaudeIssueScan["reason"]> => {
        if (++directories > MAX_CHILD_DIRS || depth > MAX_CHILD_DEPTH) return "scan_limit";
        const children = await entries(dir, MAX_DIRECTORY_ENTRIES);
        if (children === null) return "scan_limit";
        for (const child of children) {
          const path = join(dir, child.name);
          if (child.directory && (child.name === "subagents" || /^agent-[A-Za-z0-9_-]{1,128}$/.test(child.name))) {
            const failure = await walk(path, depth + 1);
            if (failure !== null) return failure;
          } else if (child.name.endsWith(".jsonl")) {
            if (!child.file || !/^agent-[A-Za-z0-9_-]{1,128}\.jsonl$/.test(child.name)) return "source_unavailable";
            files.push({ path, rootId: selected.id, root: false });
            if (files.length > limit) return "scan_limit";
          }
        }
        return null;
      };
      const failure = await walk(childRoot, 0);
      if (failure !== null) return unavailable(failure);
    }
    const rows: { run: RunRecord; rootId: string; root: boolean }[] = [];
    for (const file of files) {
      const budget = Math.min(maxTranscriptBytes, maxTotalBytes - bytesRead);
      const content = await readBounded(file.path, budget);
      if (content === null) return unavailable("scan_limit", bytesRead);
      bytesRead += Buffer.byteLength(content);
      const parsed = parseClaudeTranscript(notAfterMs === undefined ? content : transcriptAsOf(content, notAfterMs), file.path);
      if (parsed.run === null || parsed.notes.length > 0 || parsed.run.source !== "claude" ||
          parsed.run.id !== basename(file.path, ".jsonl") ||
          (file.root ? parsed.run.parentId !== null : parsed.run.parentId === null))
        return unavailable("source_unavailable", bytesRead);
      rows.push({ run: parsed.run, rootId: file.rootId, root: file.root });
    }
    const runs = rows.map(row => row.run);
    const ids = new Map(runs.map(run => [run.id, run]));
    if (ids.size !== runs.length) return unavailable("source_unavailable", bytesRead);
    for (const row of rows.filter(row => !row.root)) {
      let parent = row.run.parentId;
      const seen = new Set([row.run.id]);
      while (parent !== row.rootId) {
        if (parent === null || seen.has(parent) || !ids.has(parent)) return unavailable("source_unavailable", bytesRead);
        seen.add(parent);
        parent = ids.get(parent)!.parentId;
      }
    }
    return { runs, bytesRead, reason: null };
  } catch { return unavailable("source_unavailable", bytesRead); }
}
