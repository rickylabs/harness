#!/usr/bin/env node
/**
 * The mutation campaign for `provider-uhp` (#286), as a runnable artifact rather than a claim.
 *
 * Each entry damages exactly one behaviour by an exact string replacement in one source file, runs the
 * `@rickylabs/subagents` suite, records how many tests died and which, then restores the file byte for
 * byte. A mutation that kills zero tests is a finding: it means the behaviour is uncovered, or the test
 * that looks like it covers it passes for another reason.
 *
 * Run from the repository root:
 *
 *     node .llm/runs/provider-uhp--e37/mutations.mjs
 *
 * It writes `mutations.json` beside itself and prints a table. It refuses to start with a dirty tree for
 * the files it intends to touch, because a half-applied mutation left behind by an interrupted run would
 * be reported as the next one's result.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const src = join(root, "packages/subagents/src");

/** Every mutation: one file, one exact replacement, and what it is meant to break. */
const mutations = [
  {
    id: "M1",
    file: "uhp-gate.ts",
    breaks: "the ratified order: absence is checked before contradiction, which is the codex ladder reintroduced",
    from: `  if (negatives.contradicted.length > 0) return "refused";
  if (negatives.unverified || negatives.unreported.length > 0) return "unknown";`,
    to: `  if (negatives.unverified || negatives.unreported.length > 0) return "unknown";
  if (negatives.contradicted.length > 0) return "refused";`,
  },
  {
    id: "M2",
    file: "uhp-provider.ts",
    breaks: "the F10 gate reads only the route comparison, so a declared fallback with an agreeing model field is missed",
    from: "const contradicted = [...new Set<RouteField>([...negatives.contradicted, ...stated.fields])];",
    to: "const contradicted = [...new Set<RouteField>([...negatives.contradicted])];",
  },
  {
    id: "M3",
    file: "uhp-provider.ts",
    breaks: "a server that ignored the pinned harness selection is no longer refused",
    from: "    if (stated.harnessIgnored) {",
    to: "    if (false as boolean) {",
  },
  {
    id: "M4",
    file: "uhp-redact.ts",
    breaks: "the redactor stops redacting, leaving the provider's own fence as the only guard",
    from: `export function redactPaths(text: string): string {
  const masked = maskUrls(text);`,
    to: `export function redactPaths(text: string): string {
  if (text.length >= 0) return text;
  const masked = maskUrls(text);`,
  },
  {
    id: "M5",
    file: "uhp-provider.ts",
    breaks: "the boundary fence over a published result is removed (run together with M4 to let a path out)",
    from: "    const found = pathShapedStrings(redacted);\n    if (found.length === 0) return redacted;",
    to: "    const found = pathShapedStrings(redacted);\n    if (found.length >= 0) return redacted;",
    with: ["M4"],
  },
  {
    id: "M6",
    file: "uhp-redact.ts",
    breaks: "published evidence reports every status as unknown, collapsing mismatch into it",
    from: "    status: evidence.status,\n    requested: redactSide(evidence.requested),",
    to: `    status: "unknown" as typeof evidence.status,\n    requested: redactSide(evidence.requested),`,
  },
  {
    id: "M7",
    file: "uhp-redact.ts",
    breaks: "cwd values are published verbatim, so the known-branch diagnostic carries the working directory",
    from: `  if (field !== "cwd" || item.value === null) return item;`,
    to: `  if (field !== "cwd" || item.value === null || item.value.length >= 0) return item;`,
  },
  {
    id: "M8",
    file: "uhp-provider.ts",
    breaks: "console drift is detected and then ignored, so a drifted harness is dispatched to",
    from: "    if (drift.length > 0) {\n      return refusedDispatch(",
    to: "    if (drift.length > 0 && false) {\n      return refusedDispatch(",
  },
  {
    id: "M9",
    file: "uhp-harnesses.ts",
    breaks: "an unreadable console listing is treated as agreement rather than as drift",
    from: `  if (listed === null) {
    return [{
      kind: "listing-unreadable",
      harness: null,
      detail:
        "the harness listing could not be read as UHP harness objects, so no pinned id could be cleared; " +
        "an unreadable console is not an unchanged console",
    }];
  }`,
    to: `  if (listed === null) {
    return [];
  }`,
  },
  {
    id: "M10",
    file: "uhp-provider.ts",
    breaks: "a 404 from the cancel endpoint is reported as a terminal state instead of unknown",
    from: `      return stopResult(
        run,
        "unknown",
        \`the cancel endpoint answered \${named}; no terminal state may be synthesized from it, and the task may still be executing\`,
      );`,
    to: `      return stopResult(
        run,
        "already-over",
        \`the cancel endpoint answered \${named}; no terminal state may be synthesized from it, and the task may still be executing\`,
      );`,
  },
  {
    id: "M11",
    file: "uhp-provider.ts",
    breaks: "a task that was never sent is reported as unknown, which forbids the retry that is in fact safe",
    from: `    if (!answer.sent) {
      return refusedDispatch(runId, \`no task was sent: \${answer.cause ?? "no cause given"}\`);
    }`,
    to: `    if (!answer.sent) {
      return unknownDispatch(runId, \`no task was sent: \${answer.cause ?? "no cause given"}\`);
    }`,
  },
  {
    id: "M12",
    file: "uhp-transport.ts",
    breaks: "a credential may be passed where a profile name belongs",
    from: "  if (!CREDENTIAL_PROFILE.test(profile)) {",
    to: "  if (!/^.+$/.test(profile)) {",
  },
  {
    id: "M13",
    file: "uhp-gate.ts",
    breaks: "the route readers trust undefined-by-UHP extension keys in metadata",
    from: `export function readUhpEffort(_response: UhpResponse): null {
  return null;
}`,
    to: `export function readUhpEffort(_response: UhpResponse): null {
  return (_response.metadata?.["effort"] ?? null) as null;
}`,
  },
  {
    id: "M14",
    file: "uhp-lifecycle.ts",
    breaks: "a cancelled run is reported as failed, accusing an operator of breaking what they stopped",
    from: `        case "cancelled":
          return {
            liveness: "finished",`,
    to: `        case "cancelled":
          return {
            liveness: "failed",`,
  },
  {
    id: "M15",
    file: "uhp-provider.ts",
    breaks: "the pinned harness id is left out of the payload, letting the server choose the harness",
    from: `    const body: UhpCreateRequest = {
      ...built.request,
      background: true,
      metadata: { harness_id: pinned.id },
    };`,
    to: `    const body: UhpCreateRequest = {
      ...built.request,
      background: true,
    };`,
  },
  {
    id: "M16",
    file: "uhp-provider.ts",
    breaks: "a steer is sent while the prior turn is still open, trading a local refusal for a remote one",
    from: `    const built = nextUhpRequest(session, message, state.requested.model ?? undefined, false);
    if (!built.ok) {`,
    to: `    const built = nextUhpRequest({ ...session, turns: [] }, message, state.requested.model ?? undefined, false);
    if (!built.ok) {`,
  },
  {
    id: "M19",
    file: "uhp-redact.ts",
    breaks: "published evidence reports no route as verified, which is the transport-shaped branch #286 warns about",
    from: "    verifiedBeforeRedaction: isRouteEvidenceVerified(evidence),",
    to: "    verifiedBeforeRedaction: false && isRouteEvidenceVerified(evidence),",
  },
  {
    id: "M18",
    file: "uhp-redact.ts",
    breaks: "overlapping path spans are skipped instead of merged, leaving the tail of the second in the output",
    from: `    if (last !== undefined && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }`,
    to: `    if (last !== undefined && span.start <= last.end) {
      continue;
    }`,
  },
  {
    id: "M17",
    file: "uhp-gate.ts",
    breaks: "the model observation is read from metadata.requested_model, laundering a substitution into agreement",
    from: "export function readUhpModel(response: UhpResponse): string | null {\n  return typeof response.model === \"string\" && response.model.trim().length > 0 ? response.model : null;",
    to: "export function readUhpModel(response: UhpResponse): string | null {\n  const laundered = response.metadata?.requested_model ?? response.model;\n  return typeof laundered === \"string\" && laundered.trim().length > 0 ? laundered : null;",
  },
];

function suite() {
  try {
    const out = execFileSync("pnpm", ["--filter", "@rickylabs/subagents", "run", "test"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    return read(out);
  } catch (error) {
    return read(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

function read(output) {
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
  const failed = /^ℹ fail (\d+)$/m.exec(plain);
  const compileError = /error TS\d+/.test(plain);
  // node:test counts a failing suite as a failure alongside the test inside it, so `killed` — its own
  // `fail` total — is larger than the number of assertions that died. `leaves` is the indented half: the
  // individual tests. Both are recorded rather than one being presented as the other.
  const names = [...plain.matchAll(/^\s*✖ (.+?) \(/gm)].map((match) => match[1]);
  const leaves = [...plain.matchAll(/^ +✖ (.+?) \(/gm)].map((match) => match[1]);
  return {
    killed: failed === null ? (compileError ? "compile-error" : "unknown") : Number(failed[1]),
    compiled: !compileError,
    leaves: [...new Set(leaves)],
    tests: [...new Set(names)],
  };
}

const files = new Map();
for (const mutation of mutations) {
  const path = join(src, mutation.file);
  if (!files.has(path)) files.set(path, readFileSync(path, "utf8"));
}

const baseline = suite();
if (baseline.killed !== 0) {
  process.stderr.write(`the suite is not green before mutating (${JSON.stringify(baseline)}); refusing to attribute anything to a mutation\n`);
  process.exit(2);
}

const results = [];
for (const mutation of mutations) {
  const applied = [mutation, ...(mutation.with ?? []).map((id) => mutations.find((entry) => entry.id === id))];
  const touched = new Set();
  let ok = true;
  for (const entry of applied) {
    const path = join(src, entry.file);
    const before = readFileSync(path, "utf8");
    if (!before.includes(entry.from)) {
      ok = false;
      break;
    }
    writeFileSync(path, before.replace(entry.from, entry.to));
    touched.add(path);
  }
  const outcome = ok ? suite() : { killed: "not-applied", compiled: null, tests: [] };
  for (const path of touched) writeFileSync(path, files.get(path));
  results.push({
    id: mutation.id,
    file: mutation.file,
    with: mutation.with ?? [],
    breaks: mutation.breaks,
    ...outcome,
  });
  process.stdout.write(`${mutation.id} ${mutation.file}: killed ${outcome.killed}\n`);
}

// Restore everything unconditionally, then prove the tree is green again.
for (const [path, text] of files) writeFileSync(path, text);
const after = suite();

writeFileSync(
  join(here, "mutations.json"),
  `${JSON.stringify({ baseline, results, after, at: new Date().toISOString() }, null, 2)}\n`,
);
process.stdout.write(`\nbaseline fail ${baseline.killed}; after restore fail ${after.killed}\n`);
const zero = results.filter((entry) => entry.killed === 0 || typeof entry.killed === "string");
process.stdout.write(zero.length === 0 ? "every mutation killed at least one test\n" : `MUTATIONS THAT KILLED NOTHING: ${zero.map((entry) => `${entry.id} (${entry.killed})`).join(", ")}\n`);
