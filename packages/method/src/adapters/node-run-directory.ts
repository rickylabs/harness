import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunDirectory } from "../ports/run-directory.ts";

/** A run directory on the local filesystem. */
export function nodeRunDirectory(root: string): RunDirectory {
  const locate = (name: string) => join(root, name);
  return {
    locate,
    readText: (name) => readFile(locate(name), "utf8"),
    async readTextIfPresent(name) {
      try {
        return await readFile(locate(name), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
        throw error;
      }
    },
    writeText: (name, text) => writeFile(locate(name), text),
  };
}
