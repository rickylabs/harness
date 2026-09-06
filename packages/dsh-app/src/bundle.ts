/**
 * The `rickylabs` bundle patch layer, as data.
 *
 * `cordis.patch.yml` is what dsh reads. This module is where it comes from: the rows live here as
 * typed values and the file is *rendered* from them, so the committed YAML and the code that means
 * it cannot drift. `bundle.test.ts` re-renders and compares the bytes.
 *
 * That is not ceremony for its own sake. A patch row names a module specifier as a string, and a
 * string in a YAML file is unreachable by every tool the repository already runs — the compiler,
 * `check:graph`, the test sweep. Rendering the file from a module makes two facts checkable that
 * would otherwise only be discovered by booting dsh and reading a stack trace:
 *
 * - every row names a subpath the package's `exports` map actually publishes, and
 * - no two rows claim the same id, which a patch layer resolves by last-write-wins in silence.
 *
 * ## What belongs in this layer, and what does not
 *
 * A bundle patch states **what this bundle adds**, not what its plugins default to. Every knob our
 * plugins accept already has a default declared next to the code that reads it; restating those
 * defaults here would create a second copy that no test compares. So the rows carry `id` and `name`
 * and nothing else, and a deployment that wants to override something writes it in the *profile's*
 * `cordis.patch.yml`, which applies after ours.
 *
 * ## Ordering
 *
 * Row order carries no load semantics — cordis activates on service availability, not on file
 * order. The order here is the order a reader should meet them in: the seam E3 fills first, then
 * the two projections, then the sink that watches all of it.
 */

/** One entry this bundle inserts into the profile's plugin list. */
export interface BundleRow {
  /** Stable handle a later patch layer addresses this row by. Lowercase, hyphenated. */
  readonly id: string;
  /** Module specifier cordis imports. Must be a subpath this package's `exports` map publishes. */
  readonly name: string;
  /** Why the row exists. Rendered as a comment above it, one array element per line. */
  readonly why: readonly string[];
}

/** Name of the file this module renders. Read by dsh through `dsh.bundle.patch` in the manifest. */
export const PATCH_FILE = "cordis.patch.yml" as const;

/** Ids and module names are constrained so the rendered YAML never needs escaping. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Header comment of the rendered file. One array element per line; `""` renders a bare `#`. */
export const PATCH_HEADER: readonly string[] = [
  "The rickylabs bundle patch: the coordinator layer, applied as ONE insert over whatever",
  "the base bundles already put on the profile root.",
  "",
  "GENERATED FROM packages/dsh-app/src/bundle.ts. Edit that file and re-render; a hand edit",
  "here is reverted by the next `pnpm run build`, and `bundle.test.ts` fails in the meantime.",
  "",
  "The insert carries no `id`, so cordis appends these rows at the root of the entry list",
  "rather than nesting them into a group. Nothing here addresses a base row: this bundle adds",
  "services, it does not reconfigure dsh's own.",
  "",
  "Row order carries no load semantics; activation is service-availability driven.",
];

/**
 * The rows.
 *
 * `@rickylabs/forge` is deliberately absent: it is a CLI that stamps a label taxonomy and installs a
 * skill into a repository checkout, and a booted daemon has nothing to ask it. Adding a row for
 * symmetry would claim a seam that no caller reaches, and a service nobody injects is
 * indistinguishable from a service that does not work.
 *
 * `harness-llm` is the one row that claims nothing at all. Every other row here provides a service
 * at a key of ours; that one registers an adapter on `ctx.llm`, which is dsh's own seam and already
 * mounted by the composed profile. It is a row rather than a call somewhere else because a
 * registration has to be tied to a fiber's lifetime to survive a reload — see the plugin's own note.
 */
export const BUNDLE_ROWS: readonly BundleRow[] = [
  {
    id: "harness-subagents",
    name: "@rickylabs/dsh-app/plugins/subagents",
    why: [
      "The `ctx.subagents` seam (E3 · #33). Claimed empty here on purpose: this row exists so",
      "that a provider package has something to attach to, and so that the failure mode of a",
      "deployment with no providers is `no-providers` from `selectProvider` rather than a",
      "missing-service crash at the first dispatch.",
      "",
      "It injects `harnessTelemetry` (E9 · #83) and stays PENDING without it. Empty is not the",
      "same as unwatched: whatever E3 registers is wrapped before it reaches the context, so an",
      "uninstrumented provider is not something a provider package can produce by forgetting.",
    ],
  },
  {
    id: "harness-board",
    name: "@rickylabs/dsh-app/plugins/board",
    why: [
      "The board projector (E6 · #36), configured. GitHub holds board truth and dsh projects",
      "the live view (decision 3), so what this service owns is the taxonomy — the lane prefix",
      "and the priority order — while the caller owns the issues and the clock.",
    ],
  },
  {
    id: "harness-coordinator",
    name: "@rickylabs/dsh-app/plugins/coordinator",
    why: [
      "Workflow definitions and the evaluator independence policy (E6 · #36). The policy is",
      "configuration because #72 named two, not because both are equally good: the default is",
      "the stronger one, and choosing the weaker is a decision a deployment has to write down.",
    ],
  },
  {
    id: "harness-telemetry",
    name: "@rickylabs/dsh-app/plugins/telemetry",
    why: [
      "The run sink and snapshot builder (E9 · #39) — the `status ?` killer. Resolving the",
      "observability paths at boot rather than per call is the point: a snapshot taken after a",
      "log rotation must read the same directory the sink was writing to.",
    ],
  },
  {
    id: "harness-llm",
    name: "@rickylabs/dsh-app/plugins/llm",
    why: [
      "The three token-metered destinations — lm-studio, llama-rocm, openrouter (E2 · #176) —",
      "registered on `ctx.llm`, which `@deepseek-ai/dsh-llm` owns and the composed profile",
      "already mounts. This row claims no key; it injects `llm` and stays PENDING without it.",
      "",
      "Base URLs only. A credential is never a profile key: a profile is committed and a",
      "credential must not be, so `OPENROUTER_API_KEY` is read from the daemon's environment at",
      "dispatch. The `ctx.subagents` seam above is a different meter — quota windows, not",
      "tokens — and the two are kept apart deliberately.",
    ],
  },
];

/** Rendered comment line, at `indent` spaces. An empty string renders as a bare `#`. */
function comment(line: string, indent: string): string {
  return line === "" ? `${indent}#` : `${indent}# ${line}`;
}

/**
 * Render the patch file.
 *
 * Hand-written rather than produced by a YAML serializer, for two reasons that both come down to
 * this file being read far more often than it is parsed: a serializer drops the comments, which are
 * the only explanation of why a row exists; and it would add a dependency to the repository root
 * for one file, when what has to be checked — that the committed bytes equal these rows — is a
 * string comparison either way.
 *
 * @throws {RangeError} if a row's id or name would need YAML escaping, or two rows share an id.
 */
export function renderPatch(rows: readonly BundleRow[] = BUNDLE_ROWS): string {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!ID_PATTERN.test(row.id)) {
      throw new RangeError(`patch row id ${JSON.stringify(row.id)} is not lowercase-hyphenated`);
    }
    if (seen.has(row.id)) {
      throw new RangeError(`patch row id ${JSON.stringify(row.id)} appears twice`);
    }
    seen.add(row.id);
    if (row.name.includes("'") || /[\n\r]/.test(row.name)) {
      throw new RangeError(`patch row ${row.id} names a module that YAML would have to escape`);
    }
  }

  const out: string[] = [];
  for (const line of PATCH_HEADER) out.push(comment(line, ""));
  out.push("");
  out.push("- insert:");
  rows.forEach((row, index) => {
    if (index > 0) out.push("");
    for (const line of row.why) out.push(comment(line, "    "));
    out.push(`    - id: ${row.id}`);
    out.push(`      name: '${row.name}'`);
  });
  out.push("");
  return out.join("\n");
}

/**
 * The `exports` subpath a row's module specifier resolves through, or `null` for a specifier that
 * does not name this package at all. Used by the test that checks the manifest publishes every row.
 */
export function subpathOf(name: string, packageName: string): string | null {
  if (name === packageName) return ".";
  const prefix = `${packageName}/`;
  return name.startsWith(prefix) ? `./${name.slice(prefix.length)}` : null;
}
