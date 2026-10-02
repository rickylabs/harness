/** Private watch hints only. Events trigger a scan; they are never treated as evidence. */
import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

export interface IssueFeedChanges {
  consume(): boolean;
  setFiles(files: ReadonlySet<string>, nativeStores?: ReadonlySet<string>): void;
  close(): void;
}

/** Watch new receipts and native files, plus the bound files from the last scan. */
export function openIssueFeedChanges(receipts: string | undefined, sessions: string,
  claudeProjects?: string, claudeChildEvents?: string): IssueFeedChanges {
  let dirty = false;
  let closed = false;
  const roots = new Map<string, FSWatcher>();
  const files = new Map<string, FSWatcher>();
  const inside = (root: string, file: string): boolean => {
    if (!isAbsolute(root) || !isAbsolute(file)) return false;
    const tail = relative(root, file);
    return tail !== "" && tail !== ".." && !tail.startsWith(".." + sep);
  };
  const attach = (path: string, recursive: boolean, changed: (kind: string) => void,
    failed: () => void): FSWatcher | undefined => {
    try {
      const watcher = watch(path, { recursive, persistent: false }, event => changed(event));
      watcher.on("error", () => { dirty = true; watcher.close(); failed(); });
      return watcher;
    } catch { dirty = true; return undefined; }
  };
  const refreshRoots = () => {
    if (closed) return;
    for (const [path, kind] of [[receipts, "receipts"], [sessions, "sessions"],
      [claudeProjects, "sessions"], [claudeChildEvents, "child-events"]] as const) {
      if (!path || !isAbsolute(path) || roots.has(path)) continue;
      const watcher = attach(path, kind !== "child-events", event => {
        // Existing unrelated rollouts append often. Only new names need a full scan.
        if (kind === "receipts" || kind === "child-events" || event === "rename") dirty = true;
      }, () => roots.delete(path));
      if (watcher) roots.set(path, watcher);
    }
  };
  refreshRoots();
  return {
    consume() { const changed = dirty; dirty = false; return changed; },
    setFiles(next, nativeStores = new Set()) {
      if (closed) return;
      refreshRoots();
      for (const [path, watcher] of files) if (!next.has(path)) { watcher.close(); files.delete(path); }
      for (const path of next) {
        if (!(inside(sessions, path) || claudeProjects && inside(claudeProjects, path) ||
            claudeChildEvents && inside(claudeChildEvents, path) ||
            [...nativeStores].some(root => path === root || inside(root, path))) || files.has(path)) continue;
        const watcher = attach(path, false, () => { dirty = true; }, () => files.delete(path));
        if (watcher) files.set(path, watcher);
      }
    },
    close() {
      closed = true;
      for (const watcher of [...roots.values(), ...files.values()]) watcher.close();
      roots.clear(); files.clear();
    },
  };
}
