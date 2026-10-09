/** The summary's workspace metadata, measured on 1.3.2 as a JSON array of `file://` URIs. */
import { isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/** Exactly one `file:///` root, absolute and normalized; anything else relativizes nothing. */
export function agyWorkspaceRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const roots: unknown = JSON.parse(value);
    if (!Array.isArray(roots) || roots.length !== 1 || typeof roots[0] !== "string" || !roots[0].startsWith("file:///")) return null;
    // The URL parser resolves dot segments; the stored text itself must already be the normalized path.
    const path = fileURLToPath(roots[0]);
    return decodeURIComponent(roots[0].slice("file://".length)) === path && isAbsolute(path) && normalize(path) === path &&
      path !== "/" && !/[\x00-\x1f\x7f]/.test(path) ? path : null;
  } catch { return null; }
}
