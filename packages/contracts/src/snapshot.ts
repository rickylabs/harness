/**
 * The whole observable state of one repository, in one message.
 *
 * ## Normalized, because the wire carries deltas
 *
 * A cockpit wants a kanban board, a tree of epics, and a list of running agents. Those are three
 * views of the same tasks, and the tempting shape is to ship them as three pre-grouped structures.
 *
 * That shape breaks the moment anything changes. One task moving column is one edit in a normalized
 * snapshot and a coordinated edit in three places in a pre-grouped one, and any delta protocol built
 * on it either resends everything or gets a group out of step with its siblings — a task drawn in two
 * columns at once, or in none.
 *
 * So every task appears exactly once in `tasks`, every run exactly once in `runs`, and grouping is
 * the client's — `phase` for columns, `epic` and `milestone` for the tree, `parentId` for the run
 * tree. Each is a plain group-by over a field the server already decided.
 *
 * ## Completeness is a field, not an inference
 *
 * `complete` says whether this snapshot is the whole board. A truncated fetch produces an array that
 * is shaped exactly like a complete one, and a client cannot tell them apart by looking — so a
 * partial board silently reads as a small board, and "3 open tasks" means either good news or a
 * broken query with no way to know which. That is a real finding, and the fix is that the flag is
 * always present and the anomaly explaining it is always in `anomalies`.
 */

import type { BoardAnomaly, Lifecycle, TaskView } from "./tasks.js";
import type { GovernanceState } from "./governance.js";
import type { RunView } from "./runs.js";

/**
 * A repository, named the way GitHub names it.
 *
 * Split rather than one `owner/name` string because every client that receives the joined form
 * immediately splits it, and each of them has to decide what to do with a name containing a slash.
 */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

/**
 * Everything at once.
 *
 * This is the payload of both the `snapshot` command's response and the `snapshot` event, which is
 * the same shape on purpose: a client resyncing after a gap and a client connecting for the first
 * time are the same situation, and giving them one code path is what makes the reconnect argument
 * simple enough to be correct.
 *
 * `lifecycle` travels here, as data. The server's columns are the server's; a cockpit compiled six
 * months ago against a different phase list still draws the board the coordinator actually has. See
 * the note in `tasks.ts` for why the list is not a constant in this package.
 */
export interface RemoteSnapshot {
  /** The event-protocol version this snapshot was produced for. See `PROTOCOL_VERSION`. */
  readonly protocol: number;
  /** The connection generation this snapshot belongs to. A frame from another generation is stale. */
  readonly generation: number;
  readonly generatedAt: string;
  /** False when the projection was truncated. The reason is in `anomalies`. */
  readonly complete: boolean;
  readonly repo: RepoRef;
  readonly lifecycle: Lifecycle;
  readonly tasks: readonly TaskView[];
  readonly runs: readonly RunView[];
  readonly anomalies: readonly BoardAnomaly[];
  readonly governance: GovernanceState;
  /** Anything an operator should read that is not attached to a task, a run, or a regime. */
  readonly notes: readonly string[];
}
