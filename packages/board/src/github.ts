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
  stateReason?: string | null;
  body?: string;
  headRefName?: string;
}

const MAX_BUFFER = 32 * 1024 * 1024;

/** What we say when the thrown value will not tell us anything. */
const UNREADABLE = "the underlying error could not be read";

/**
 * Read a message out of an unknown thrown value, without trusting the value to cooperate.
 *
 * `error.message` looks like a field read and is a method call: an `Error` subclass can define
 * `message` as a throwing getter, a `Proxy` can trap it, and `String(error)` runs a `toString` this
 * module did not write. `transportFailure` claims totality in its doc comment, and that claim was
 * only true for errors that cooperated. A classifier that throws while classifying is the worst of
 * the failures it exists to prevent: the caller gets no `TransportUnavailable`, so the CLI never
 * reaches the exit code and advice this whole module is for, and the operator sees a stack trace
 * from inside the error handler instead.
 *
 * Losing the message is an acceptable price; losing the classification is not.
 */
function messageOf(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message: unknown = error.message;
      if (typeof message === "string") return message;
    }
    return String(error);
  } catch {
    return UNREADABLE;
  }
}

/**
 * Classify a failed `gh` invocation.
 *
 * Total by construction: every input returns a `TransportUnavailable`, including an input that
 * fights back — see `messageOf`. The recognised cases exist only to give better advice, never to
 * decide *whether* this is a transport failure; that was the defect. A classifier with a
 * fall-through is one that behaves differently on a network nobody tested against.
 */
export function transportFailure(error: unknown): TransportUnavailable {
  const message = messageOf(error);
  if (/ENOENT/.test(message)) {
    return new TransportUnavailable("gh is not installed or not on PATH");
  }
  if (/auth|credential|HTTP 401|HTTP 403/i.test(message)) {
    return new TransportUnavailable(`gh is not authenticated: ${message}`);
  }
  return new TransportUnavailable(`gh could not read from GitHub: ${message}`);
}

/**
 * The `gh` invocations this adapter is permitted to make.
 *
 * "Read-only by construction" was, until now, construction by comment. The seam below is exported
 * from the package root and injectable, so its signature is the contract every caller programs
 * against — and a signature reading `readonly string[]` says the adapter may issue any `gh`
 * command at all. Nothing in the type stopped a future edit here from adding `issue edit`, and
 * nothing told a reader of the public API what the module promises.
 *
 * So the promise is written down. These are the three verbs this module issues, spelled out; the
 * compiler rejects a fourth at the call site rather than in review. `gh api` is deliberately absent
 * even though it can read: it is the one subcommand whose read-ness lives in a flag, and a rule you
 * have to check the arguments to apply is not one a type can keep.
 *
 * This constrains what this module *sends*, which is the part it owns. An injected runner is the
 * caller's own code and can do as it likes once called — that is unavoidable in any seam, and the
 * reason the default runner is the real one.
 */
export type GhReadArgs =
  | readonly ["issue", "list", ...string[]]
  | readonly ["pr", "list", ...string[]]
  | readonly ["repo", "view", ...string[]];

/**
 * How this module reaches GitHub.
 *
 * Injectable so that the argv it builds, the payloads it accepts, and the completeness it infers
 * are all testable without a network or a credential. The default is the real one.
 */
export type GhRunner = (args: GhReadArgs, cwd?: string) => Promise<string>;

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
      `gh returned unparseable output for ${kind}s: ${messageOf(error)}`,
    );
  }
  if (!Array.isArray(raw)) {
    throw new TransportUnavailable(`gh returned a non-array payload for ${kind}s`);
  }
  return raw.map((item) => normalise(item as GhItem, kind));
}

/**
 * GitHub's `stateReason` for an issue, narrowed to the two endings the taxonomy cares about.
 *
 * Anything else — including an open issue, which reports no reason at all — becomes `null` rather
 * than being folded into `"not-planned"`. The difference matters: `not-planned` is a statement that
 * the work will not happen, and `closed-without-status` stays silent on it, so guessing it for an
 * unrecognised value would silence the rule for exactly the rows nobody has classified.
 */
function closureReason(raw: string | null | undefined): "completed" | "not-planned" | null {
  switch ((raw ?? "").toUpperCase()) {
    case "COMPLETED":
      return "completed";
    case "NOT_PLANNED":
      return "not-planned";
    default:
      return null;
  }
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
  if (kind !== "pull-request") return { ...base, closedBecause: closureReason(raw.stateReason) };
  return {
    ...base,
    draft: raw.isDraft === true,
    // A closed-unmerged PR is not a shipped one, and conflating the two is how a board reports
    // work as landed that was actually abandoned.
    merged: typeof raw.mergedAt === "string" && raw.mergedAt !== "",
    // Spread conditionally rather than assigned: under `exactOptionalPropertyTypes` an explicit
    // `body: undefined` is a different type from an absent `body`, and only the second one means
    // "GitHub told us nothing" — which is what a payload without the field actually says.
    ...(typeof raw.body === "string" ? { body: raw.body } : {}),
    ...(typeof raw.headRefName === "string" && raw.headRefName !== "" ? { headRef: raw.headRefName } : {}),
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
  // `stateReason` on issues only. It is how "closed as completed" is told apart from "closed as
  // not-planned", which the taxonomy gives opposite labels — shipped, or no status label at all —
  // and `gh pr list` does not offer the field at all.
  const issueFields =
    "number,title,state,url,createdAt,updatedAt,labels,assignees,milestone,stateReason";
  const commonFields = "number,title,state,url,createdAt,updatedAt,labels,assignees,milestone";
  // `body` on pull requests only. Closing keywords live in a PR description and nowhere else, and
  // bodies dominate the payload size — asking for them on issues too would roughly double the
  // transfer of every projection to fetch text no rule reads.
  // `headRefName` likewise. It is the only link a dispatched delivery has back to the issue that
  // ordered it when the two live in different repositories: GitHub's closing keywords close nothing
  // across a repository boundary, so a PR in the target repo cannot reference the inbox issue that
  // way, and the branch name is what carries the number instead.
  const prFields = `${commonFields},isDraft,mergedAt,body,headRefName`;

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
