#!/usr/bin/env node
import { resolveWireFamily } from "./producer-names.js";
/**
 * `harness-telemetry` — status without an agent in the loop.
 *
 * The command exists to make one sentence false: "I'm constantly spamming `status ?` to my current
 * orchestrator because I have zero visibility across the board." So it must work when every agent
 * is asleep, when the coordinator has crashed, and when the network is down. It reads files and explicitly configured observation services.
 *
 * Board items are read from a JSON file rather than fetched, because the fetch belongs to the board
 * package and a status command that needs a GitHub token is a status command that fails exactly
 * when the token is the problem.
 *
 * The exit statuses are disjoint and documented in `EXIT_MEANINGS`, because this command gets run
 * from scripts and cron. The one that matters is 3: the answer printed above it is real but partial,
 * and a caller that treats it as complete will conclude the board is quiet when in fact the scan
 * could not see. Every other status collapses into "it worked", "you asked wrong", or "I broke".
 */

import { codexThreadsCommand } from "./codex-threads-cli.js";
import { issueAgentFeedCommand } from "./issue-agent-feed-cli.js";
import { actionReceiptCommand } from "./action-receipt-cli.js";
import { OperatorConfigurationError, resolveOperatorSetting } from "./operator-environment.js";
import { OperatorLogError, readObservabilityLog } from "./log-source.js";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { backfillFromDisk, defaultRoots, type BackfillRoots } from "./backfill/index.js";
import { diagnosticsFor } from "./diagnostics.js";
import { buildAgentObservations } from "./agent-observations.js";
import { readDispatchEvidence } from "./dispatch-evidence.js";
import { readOrchidDispatches, bindOrchidDispatchEvidence } from "./orchid-dispatch.js";
import { foldLiveEvents, mergeLiveRuns } from "./live.js";
import { resolveObservability } from "./observability.js";
import { publicRuns, publicSnapshot, publicTree } from "./public.js";
import { renderSnapshot, renderTree } from "./render.js";
import { buildSnapshot } from "./snapshot.js";
import { buildTree } from "./tree.js";
import { instant, parseSource, type GovernanceSource } from "./source.js";
import { collectRepositoryRunObservation, type RepositoryRunReadOptions } from "./repository-run-observation.js";
import { invalidGovernance } from "./governance/read.js";
import { collectGovernance, defaultSourceServices, type SourceServices } from "./governance/collect.js";
import { parseFlags, type Flags } from "./cli-flags.js";
import { loadGovernance, loadItems, recordEvents, whereItWrites, writeNotes } from "./cli-io.js";

/**
 * What the command exited with, and what a caller should do about it.
 *
 * Exit 1 used to cover both a `why` that found nothing and an internal crash, and exit 0 covered
 * three unreadable stores (finding F-7 on #105) — so a script could not tell success from missing
 * evidence from a bug. These are disjoint, and 3 outranks 4: "I did not find it" and "I could not
 * see everywhere" are different answers, and when both are true the second is the one to act on.
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  incomplete: 3,
  notFound: 4,
} as const;

/**
 * One sentence per code, keyed on `EXIT` — so a code added without a meaning is a type error
 * rather than an undocumented number a script discovers at 2am.
 *
 * This is the only statement of these meanings. The `exit codes` block in `USAGE` renders from it,
 * and so does `docs/reference/cli/harness-telemetry.md`, which `pnpm run check:docs` byte-compares.
 */
export const EXIT_MEANINGS: Readonly<Record<keyof typeof EXIT, string>> = {
  ok: "the picture is complete",
  failed: "harness-telemetry itself failed",
  usage: "the command line was wrong",
  incomplete: "the picture is incomplete: a store could not be read, or a scan hit --limit",
  notFound: "nothing matched, on a scan that could see everything",
};

const EXIT_BLOCK = Object.entries(EXIT)
  .map(([name, code]) => `  ${code}  ${EXIT_MEANINGS[name as keyof typeof EXIT]}`)
  .join("\n");

const USAGE = `harness-telemetry — board activity, read from disk, with no agent awake

usage:
  harness-telemetry codex-threads [--limit <n>] [--private] [--watch]  native thread JSON / goal JSONL
  harness-telemetry action-receipt --json --operation <uuid> [--digest <sha256>]  sanitized Orchid delivery
  harness-telemetry issue-agents [--json | --watch] [--home <path>] [--limit <n>] [--issue <owner/repo#number>] [--interval-ms <n>] [--partial-trees]  per-issue agent trees
  harness-telemetry run-observation --source <absolute descriptor path>  selected enrolled run JSON
  harness-telemetry governance --observations-from <descriptor>  typed governance JSON
  harness-telemetry account-usage --source <descriptor> [--watch]  subscription quota and session token JSON
  harness-telemetry tree [options]       milestone → epic → task → subagent, the whole board
  harness-telemetry status [options]     runs grouped by epic
  harness-telemetry runs [options]       one line per run, newest first
  harness-telemetry why <run-id>         which log to open first for that run
  harness-telemetry record [options]     append events to the observability log
  harness-telemetry where [options]      where that log is, and the layers below a run

options:
  --home <path>          home directory the stores live under (default: this user's)
  --items <path>         board items to join runs to: "harness-board snapshot" output, or a
                         JSON array of {number, title, epic, milestone, phase} refs
  --observations <path>  governance read JSON (the "governance" output) for tree/status
  --observations-from <spec>  live source descriptor JSON path, or file:<absolute-path>
  --limit <n>            runs to read per seam, most recent first (default: 500)
  --since <iso>          only runs with activity at or after this time
  --now <iso>            reference time for ages, so output is reproducible
  --json                 machine-readable output
  --run <id>             with "record": the run one event belongs to
  --kind <name>          with "record": write that one event instead of reading stdin
  --help

"--observations" is optional and applies to "tree" and "status". It reads one governance read
document, the JSON "governance" prints: subscription windows, provider spend, host RAM/VRAM and
item-scoped refused admissions, evaluated again at --now. The file is reread on every invocation.
No flag is explicit UNKNOWN/UNAVAILABLE; a requested unreadable or invalid file is incomplete
(exit 3). Stale values stay visible as STALE, and missing measurements stay unknown, never zero.

"--observations-from" applies to governance/tree/status and excludes "--observations". A descriptor
configures independent usage, spend, configured-cgroup-v2 and recorded-admission readers.
Model IDs, window durations and safe labels are runtime configuration. No model is dispatched.
Live readings use collection completion time unless --now explicitly sets the evaluation clock.
A failed requested leg is unread, keeps successful legs visible, and returns incomplete (exit 3).
All-unconfigured is UNAVAILABLE/exit 3. Unlimited cgroup total/headroom and pending approvals are
unknown. File mode retains stale values and its existing exit behavior. See telemetry README
for descriptor fields, the env-only service dependency and public-safe admission reason codes.

"governance" emits one versioned JSON document (also without --json). It requires a descriptor,
refuses file: and --observations/--items/--run/--kind/--limit/--since, and scans no transcripts.
Exit 0 means configured evidence is complete; exit 3 means incomplete or unavailable.
Exit 1 emits no document and a fixed diagnostic. Pending approvals remain not-observed.

"run-observation" accepts only --source and one absolute local descriptor path.
It reads one selected Codex native file, with source-root and enrolled worktree checks.
Exit 0 means the selected source was read; exit 3 withholds the run with typed coverage.
Invalid descriptors exit 1 with a fixed diagnostic and no JSON. No home scan or network.

"action-receipt" reads one owner-only Orchid delivery result from HARNESS_TELEMETRY_DISPATCH_ROOT.
It requires --json and --operation with a lowercase UUID; --digest selects that request's
primary result or immutable digest-conflict rejection. Output contains only bounded issue,
opaque agent/dispatch identifiers, digest, action, delivery outcome, fixed reason and time.
Private host, pane, native session, idempotency key and action text never leave the reader.
Exit 0 means an accepted or rejected delivery result was read; exit 3 means unknown or unread.
Delivery never proves execution; use the separate issue-agent feed for observed state.

"record" reads JSONL on stdin — one {"runId","kind","at","detail"} object per line, "at"
and "detail" optional. A bad line loses that line and is named; an empty batch is not an
error. The log is bounded and rotated, and it is the same file whether an agent, a shell
hook or a daemon wrote it.

"tree", "status", "runs" and "why" read that log back and merge it into the transcripts by
run id. The Claude and opencode stores write no completion marker, so a run recovered from
either of them reads "unknown" forever unless something says otherwise; a recorded event
whose detail carries "outcome" is what says otherwise. "detail" keys that mean something
here: source, outcome, parentId, branch, model, effort, provider, profile. A live outcome
fills in a transcript that could not say and never overrules one that could, and a run the
log knows about with no "source" is counted rather than guessed at.

environment:
  HARNESS_TELEMETRY_DIR          live log directory (default: ~/observability)
  HARNESS_TELEMETRY_ARCHIVE      cold tier for rotated generations, or "none" to delete them
                                 (default: ~/archives)
  HARNESS_TELEMETRY_MAX_BYTES    bound per generation, e.g. 33554432 or 32M
  HARNESS_TELEMETRY_GENERATIONS  generations kept behind the live file
  HARNESS_TELEMETRY_WIRE_FAMILY  harness or legacy; default legacy until reader rollout
  HARNESS_TELEMETRY_LOG_NAME     explicit harness-telemetry.jsonl or dsh-telemetry.jsonl
                                 (default remains dsh-telemetry.jsonl until producer rollout)
  HARNESS_TELEMETRY_DISPATCH_ROOT           private Orchid receipt root
  HARNESS_TELEMETRY_CLAUDE_CHILD_EVENT_ROOT private Claude child-start root
  HARNESS_TELEMETRY_PLACEMENT_HOST          exact verified host label

The corresponding DSH_TELEMETRY_* settings remain legacy aliases. Equal dual values are accepted;
conflicting values refuse the source. Native bindings keep exact values and existing private-source
checks. LOG_NAME is new and has no legacy alias. Readers and writers refuse mixed log families,
including rotations outside the configured count. A selected canonical source must contain valid
events; migration requires stopping writers and moving the whole family before changing settings.

exit codes:
${EXIT_BLOCK}
`;


export async function main(argv: readonly string[], services: SourceServices = defaultSourceServices(), observationOptions: RepositoryRunReadOptions = {}): Promise<number> {
  try { return await mainConfigured(argv, services, observationOptions); }
  catch (error) {
    if (!(error instanceof OperatorConfigurationError) && !(error instanceof OperatorLogError)) throw error;
    process.stderr.write(`harness-telemetry: ${error.message}\n`);
    return EXIT.incomplete;
  }
}

async function mainConfigured(argv: readonly string[], services: SourceServices, observationOptions: RepositoryRunReadOptions): Promise<number> {
  if (argv[0] === "account-usage") return accountUsageCommand(argv.slice(1));
  if (argv[0] === "codex-threads") return codexThreadsCommand(argv.slice(1));
  if (argv[0] === "issue-agents") return issueAgentFeedCommand(argv.slice(1), { env: services.env });
  if (argv[0] === "action-receipt") return actionReceiptCommand(argv.slice(1), services.env);
  if (argv.includes("run-observation")) {
    if (argv.length !== 3 || argv[0] !== "run-observation" || argv[1] !== "--source" || !argv[2] || !isAbsolute(argv[2]) || /[\x00-\x1f\x7f]/.test(argv[2])) {
      process.stderr.write("run-observation: invalid command line\n");
      return EXIT.usage;
    }
    try {
      const observation = await collectRepositoryRunObservation(argv[2], observationOptions);
      process.stdout.write(`${JSON.stringify(observation)}\n`);
      return observation.coverage.status === "read" ? EXIT.ok : EXIT.incomplete;
    } catch {
      process.stderr.write("run-observation: invalid descriptor or collection failed\n");
      return EXIT.failed;
    }
  }
  let flags: Flags;
  const governanceCommand = argv.includes("governance");
  try {
    flags = parseFlags(argv);
  } catch (error) {
    if (governanceCommand) process.stderr.write("governance: invalid command line\n");
    else process.stdout.write(`${String(error instanceof Error ? error.message : error)}\n\n${USAGE}`);
    return EXIT.usage;
  }
  if (flags.help || flags.rest.length === 0) {
    process.stdout.write(USAGE);
    return flags.help ? EXIT.ok : EXIT.usage;
  }

  const command = flags.rest[0];

  // Dispatched before the scan, and deliberately. `record` and `why` answer different questions, but
  // `record` must land a line when every transcript store on the box is unreadable — reading three
  // of them to append one event would make the writer as fragile as the thing it exists to explain.
  if (command === "governance") {
    if (flags.rest.length !== 1 || flags.observationsFrom === null || flags.observationsFrom.startsWith("file:") ||
        ["--observations", "--items", "--run", "--kind", "--limit", "--since"].some(flag => argv.includes(flag))) {
      process.stderr.write("governance: invalid command line\n"); return EXIT.usage;
    }
    try { instant(flags.now); } catch { process.stderr.write("governance: invalid command line\n"); return EXIT.usage; }
    let wireFamily: ReturnType<typeof resolveWireFamily>;
    try { wireFamily = resolveWireFamily(services.env); }
    catch { process.stderr.write("governance: invalid HARNESS_TELEMETRY_WIRE_FAMILY\n"); return EXIT.usage; }
    let configured: GovernanceSource;
    try { configured = parseSource(JSON.parse(await services.readText(flags.observationsFrom, 4_194_304)) as unknown); }
    catch { process.stderr.write("governance: invalid descriptor\n"); return EXIT.usage; }
    try {
      const log = configured.admissions === null ? { files: [], notes: [], degraded: false }
        : await readObservabilityLog(resolveObservability(flags.home, services.env), flags.now);
      const { observed: document } = await collectGovernance(configured, log, services, flags.nowExplicit ? flags.now : undefined, wireFamily);
      process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
      return document.complete ? EXIT.ok : EXIT.incomplete;
    } catch { process.stderr.write("governance: document unavailable\n"); return EXIT.failed; }
  }
  if (command === "record") return EXIT[await recordEvents(flags, services.env)];
  if (command === "where") return EXIT[whereItWrites(flags, services.env)];

  const wireFamily = command === "runs" && flags.json ? resolveWireFamily(services.env) : "legacy";
  let source: GovernanceSource | null = null;
  let observationPath = flags.observations;
  if (flags.observationsFrom !== null) {
    if (flags.observationsFrom.startsWith("file:")) observationPath = flags.observationsFrom.slice(5);
    else {
      try { source = parseSource(JSON.parse(await services.readText(flags.observationsFrom, 4_194_304)) as unknown); }
      catch { process.stdout.write("governance source: invalid-descriptor\n"); return EXIT.usage; }
    }
  }
  const roots: BackfillRoots = defaultRoots(flags.home);
  const scan = await backfillFromDisk(roots, { limit: flags.limit, sinceMs: flags.sinceMs });

  // Then the log this command has been writing since #83 and never reading. The transcript stores
  // are the record of what a vendor wrote down; the log is the record of what something on this box
  // observed, and for two of the three seams it is the only thing that can say a run ended at all.
  // Resolution notes are dropped here on purpose: they are about where telemetry would be *written*,
  // which is `where`'s question, and repeating them under every `status` would train an operator to
  // skip the line that matters.
  const target = resolveObservability(flags.home, services.env);
  const log = await readObservabilityLog(target, flags.now);
  // An admission receipt is evidence about a gate, not a run lifecycle event.
  const runFiles = source === null ? log.files : log.files.map(file => ({ ...file,
    events: file.events.filter(event => event.kind !== "governance.admission"),
  }));
  const merged = mergeLiveRuns(scan.runs, foldLiveEvents(runFiles));
  const orchid = command === "runs" && flags.json
    ? await readOrchidDispatches(resolveOperatorSetting(services.env, "dispatchRoot"))
    : { root: undefined, reason: null, dispatches: [], notes: [], degraded: false };
  const view = {
    notes: [...scan.notes, ...log.notes, ...merged.notes, ...orchid.notes],
    degraded: scan.degraded || log.degraded || merged.degraded || orchid.degraded,
  };

  // The stores are bounded by mtime and by the database's own `where`, which is coarse: a transcript
  // written after the cutoff can still hold nothing but older activity. This is the exact filter,
  // and it runs after the merge so that a run the log moved into the window is inside it.
  const sinceMs = flags.sinceMs;
  const runs =
    sinceMs === null ? merged.runs : merged.runs.filter((r) => Date.parse(r.updatedAt) >= sinceMs);

  if (command === "why") {
    const id = flags.rest[1];
    if (id === undefined) {
      process.stdout.write("harness-telemetry why <run-id>\n");
      return EXIT.usage;
    }
    const run = runs.find((r) => r.id === id || r.id.startsWith(id));
    if (run === undefined) {
      process.stdout.write(`no run matching ${id} in this scan\n`);
      if (!view.degraded) return EXIT.notFound;
      writeNotes(view.notes);
      return EXIT.incomplete;
    }
    const pointers = diagnosticsFor(run);
    if (flags.json) {
      // The transcript path leaves through this command and no other. It names a home directory, so
      // `status` and `runs` withhold it (finding F-5 on #105) — but `why` is run by an operator on
      // the box the file is on, and handing back the file to open is the whole command.
      process.stdout.write(
        `${JSON.stringify({ run: run.id, transcript: run.origin, pointers }, null, 2)}\n`,
      );
      return EXIT.ok;
    }
    process.stdout.write(`${run.id} (${run.source}, ${run.outcome}) — look here, in this order:\n\n`);
    // The run's own transcript first: whatever else is true of the box, that file says something
    // about this run, and the pointers below it are guesses about the layer underneath.
    process.stdout.write(`  the run's own transcript\n    ${run.origin}\n\n`);
    for (const p of pointers) {
      process.stdout.write(`  ${p.what}\n    ${p.where}\n    grep: ${p.grep}\n    why: ${p.why}\n\n`);
    }
    // A `why` that found its run answered its question completely, whatever else the scan missed.
    return EXIT.ok;
  }

  if (command === "runs") {
    if (flags.json) {
      const evidence = readDispatchEvidence(runFiles);
      const bound = bindOrchidDispatchEvidence(orchid.dispatches, evidence);
      const orchidIds = new Set(orchid.dispatches.map(d => d.runId));
      const envelope = publicRuns(flags.now, runs, view.notes, !view.degraded && !bound.degraded,
        [...evidence.filter(d => !orchidIds.has(d.runId)), ...bound.dispatches]);
      const agentObservations = buildAgentObservations({ wireFamily, dispatches: bound.dispatches, runs: merged.runs,
        observedAt: flags.now, sourceBound: resolveOperatorSetting(services.env, "dispatchRoot") !== undefined,
        dispatchComplete: !orchid.degraded && !bound.degraded, nativeComplete: !scan.degraded && !merged.degraded });
      process.stdout.write(`${JSON.stringify({ ...envelope, agentObservations }, null, 2)}\n`);
      return view.degraded ? EXIT.incomplete : EXIT.ok;
    }
    for (const run of runs) {
      const model = run.identity.model ?? "model unrecorded";
      // Issue numbers rather than a title: a run record carries no prose, by design. What a reader
      // wants here is which board item this was, and the number is the join to it.
      const about = run.linkedIssues.map((link) => `#${link.number}`).join(" ");
      process.stdout.write(
        `${run.updatedAt}  ${run.source.padEnd(9)} ${run.outcome.padEnd(8)} ${model}  ${about}\n`,
      );
    }
    if (!view.degraded) return EXIT.ok;
    // An empty list from a truncated scan looks exactly like an empty board. It is not.
    writeNotes(view.notes);
    return EXIT.incomplete;
  }

  if (command === "status" || command === "tree") {
    const [loaded, collected] = await Promise.all([
      loadItems(flags.items),
      source === null
        ? loadGovernance(observationPath, flags.now).then(observed => ({ observed, completion: flags.now }))
        : collectGovernance(source, log, services, flags.nowExplicit ? flags.now : undefined).then(
          ({ observed, completion }) => ({ observed: { governance: observed, notes: observed.notes, ok: observed.complete }, completion }),
          (error: unknown) => {
            // Only a document the contract refused becomes visible unavailability; anything else is a bug.
            const reason = "governance document unavailable";
            if (!(error instanceof Error) || error.message !== reason) throw error;
            return { observed: { governance: invalidGovernance(flags.now, [reason]), notes: [reason], ok: false }, completion: flags.now };
          }),
    ]);
    const { observed } = collected;
    const now = source !== null && !flags.nowExplicit ? collected.completion : flags.now;
    const notes = [...view.notes, ...loaded.notes, ...observed.notes];
    const complete = !view.degraded && loaded.ok && observed.ok;
    const snapshot = buildSnapshot({
      generatedAt: now,
      runs,
      items: loaded.items,
      notes,
      governance: observed.governance,
    });
    if (command === "tree") {
      // The same snapshot, so attribution is decided once and both commands agree about which run
      // belongs to which item. The items are handed over a second time on purpose: a snapshot only
      // retains items that runs attached to, and this view exists for the ones nobody has touched.
      const tree = buildTree({ snapshot, items: loaded.items, now });
      process.stdout.write(
        flags.json
          ? `${JSON.stringify(publicTree(tree, complete), null, 2)}\n`
          : `${renderTree(tree, now)}\n`,
      );
      return complete ? EXIT.ok : EXIT.incomplete;
    }
    process.stdout.write(
      flags.json
        ? `${JSON.stringify(publicSnapshot(snapshot, complete), null, 2)}\n`
        : `${renderSnapshot(snapshot, now)}\n`,
    );
    return complete ? EXIT.ok : EXIT.incomplete;
  }

  process.stdout.write(`unknown command: ${String(command)}\n\n${USAGE}`);
  return EXIT.usage;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stdout.write(`harness-telemetry failed: ${String(error)}\n`);
      process.exitCode = EXIT.failed;
    });
}

import { accountUsageCommand } from "./account-usage-cli.js";
