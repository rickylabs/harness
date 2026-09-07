#!/usr/bin/env node
/**
 * Assert that every label `dsh-board` branches on is one `dsh-forge init` would create.
 *
 * `type:epic` sat in `packages/board/src/project.ts` for the life of the file, as one of two
 * alternatives in the predicate deciding whether an issue is an epic. It never once evaluated
 * true, because the label does not exist and the taxonomy has never created it (#202). Nothing in
 * the repository could have caught it. Types cannot: a label is a string, and
 * `labels.includes("type:epic")` is as well-typed as `labels.includes("epic")`. Tests did not, and
 * made it worse — a fixture manufactured the label, so the dead branch had a passing test standing
 * behind data that cannot occur. `labels plan` could not: it compares the taxonomy against the
 * *repository*, so a label the code reads and neither side creates is invisible to it in both
 * directions.
 *
 * That is a whole direction of drift nothing measured — the set of labels the code reads against
 * the set the taxonomy creates — and this script is it.
 *
 * Neither package can check it alone, for the reason `check-lifecycle.mjs` gives about the same
 * pair: `board` must not depend on `forge`, because the projector is meant to be pointed at
 * repositories that were never forged, and `forge` must not depend on `board`, because it stamps
 * labels and has no opinion about who reads them. The repository is the only place that can see
 * both.
 *
 * Unlike `check-lifecycle.mjs` this reads no source. It runs *after* `pnpm -r run build`, so it
 * imports the real exported constants from `dist` and compares values rather than matching text.
 * That is exact where a regex is a guess, and it is why the registry has to be exported data in
 * the first place — which is the shape #232 moved `EPIC_LABEL` into and #233 asked for.
 *
 * Four comparisons, all against the live core taxonomy plus the derived families:
 *
 *   1. `name`   — a whole label compared for equality must exist as a label.
 *   2. `family` — a prefix the projector reads values from must be a prefix something creates.
 *   3. `value`  — a named value must exist as `family:value`.
 *   4. The reverse of 3, for families the registry claims to *enumerate*: a taxonomy value nobody
 *      declared is the same defect wearing the other hat. It does not fail loudly; it sorts
 *      quietly to the end of every column.
 *
 * Retired rows do not count as creatable, and are reported apart from labels that never existed.
 * Retiring is not deleting — the label stays on the repository and on the items that carried it —
 * but `init` never stamps one again, so a fresh repository would not have it, and code branching
 * on one goes dead on the next repository it meets. The two failures need different words: for a
 * label nobody ever created, adding a taxonomy row is a legitimate fix; for a retired one it is
 * exactly the wrong move, and the right one is already recorded in `supersededBy`.
 *
 * Deliberately not checked: labels nobody branches on. `task`, `decision`, `dsh`, `lane:*` and
 * `harness` exist on this repository and the code reads none of them. That is a curation question
 * and it belongs to #234, not here — a check that answers two questions at once gets argued with
 * on the strength of its weaker half.
 *
 * Also not checked: the `status:` family, which is `check-lifecycle.mjs`'s whole subject. Two gates
 * asserting one thing disagree eventually, and then the interesting question becomes which of them
 * is wrong.
 *
 * Exit codes: 0 the registry and the taxonomy agree, 1 they do not, 2 nothing could be compared —
 * a broken check, which is not the same as a passing one.
 */

import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BOARD_DIST = join(repoRoot, "packages/board/dist/index.js");
const FORGE_DIST = join(repoRoot, "packages/forge/dist/index.js");

/** Where the registry itself is declared — the file a reader edits to answer half of these. */
const REGISTRY = "packages/board/src/labels.ts";

/** Any slug would do. This one is only ever used to read a constructor's prefix back off it. */
const PROBE = "probe";

/** Constructors take a description; nothing here reads it. */
const DESCRIPTION = "probe";

const rel = (path) => relative(repoRoot, path).split("\\").join("/");

async function load(path, what) {
  if (!existsSync(path)) {
    throw new Error(
      `${what} is not built — ${rel(path)} does not exist. This check reads exported constants ` +
        "rather than source, so it runs after `pnpm -r run build` and cannot run before it.",
    );
  }
  return import(pathToFileURL(path).href);
}

/** The prefix of a `family:value` name, or null for a bare label like `epic`. */
function prefixOf(name) {
  const at = name.indexOf(":");
  return at === -1 ? null : name.slice(0, at);
}

/**
 * What `dsh-forge init` would create: every live core label by name, and every prefix that any
 * core row or derived-family constructor produces.
 *
 * The derived families are probed rather than listed, because listing them here would be a third
 * copy of the same fact and this file exists because second copies drift.
 *
 * `CORE_TAXONOMY` holds only live rows today — retirement moves a spec to `RETIRED_LABELS` — so
 * the `supersededBy` filter below is a guard rather than a working part. It is here because the
 * failure it prevents is silent: a retired row that ever landed in the core list would make this
 * check certify a dead label as creatable, which is the exact outcome it exists to prevent.
 */
function creatableFrom(forge, lanePrefix) {
  const core = forge.CORE_TAXONOMY;
  if (!Array.isArray(core) || core.length === 0) {
    throw new Error("CORE_TAXONOMY is empty — there is nothing to compare the registry against");
  }

  const live = core.filter((label) => label.supersededBy === undefined);
  const names = new Set(live.map((label) => label.name));
  const prefixes = new Set();
  for (const label of live) {
    const prefix = prefixOf(label.name);
    if (prefix !== null) prefixes.add(prefix);
  }

  // Name -> what replaced it, so a branch on a retired label can be told what to read instead.
  const retired = new Map();
  for (const label of [...(forge.RETIRED_LABELS ?? []), ...core]) {
    if (label.supersededBy === undefined) continue;
    retired.set(label.name, label.supersededBy);
  }

  // `lane` is passed the board's own default on purpose: it is the one family whose prefix a
  // repository may rename, and the only claim worth making about it here is that the board's
  // default is a prefix the taxonomy can build. Whether that default agrees with forge's own
  // fallback is a separate assertion, made below where it can be reported separately.
  const derived = [
    forge.areaLabel(PROBE, DESCRIPTION),
    forge.gateLabel(PROBE, DESCRIPTION),
    forge.ciLabel(PROBE, DESCRIPTION),
    forge.waveLabel(PROBE, DESCRIPTION),
    forge.epicLabel(PROBE, DESCRIPTION),
    forge.laneLabel(PROBE, lanePrefix, DESCRIPTION),
  ];
  for (const spec of derived) {
    const prefix = prefixOf(spec.name);
    if (prefix === null || spec.name !== `${prefix}:${PROBE}`) {
      throw new Error(
        `a derived-family constructor produced ${JSON.stringify(spec.name)} from slug ` +
          `${JSON.stringify(PROBE)}, which is not \`prefix:slug\` — this check cannot read the ` +
          "family it belongs to, and guessing is how it starts passing for the wrong reason",
      );
    }
    prefixes.add(prefix);
  }

  return { names, prefixes, retired, live: live.length };
}

/** One problem, phrased so the reader knows which of the two sides to change. */
const problem = (headline, ...rest) => [headline, ...rest].join("\n      ");

/**
 * The tail of a failure about a whole label name.
 *
 * A retired label and a label that never existed are the same symptom and opposite fixes, so they
 * get different words. "Add a row" is right for the second and precisely wrong for the first —
 * un-retiring a label to satisfy a check would resurrect the vocabulary the retirement removed.
 */
function missingNameTail(literal, creatable) {
  const replacement = creatable.retired.get(literal);
  if (replacement !== undefined) {
    return [
      `but that label is retired — \`dsh-forge init\` no longer creates it, and existing items keep`,
      `it only so their record stays readable. Read \`${replacement}\` instead. Do not un-retire it`,
      "to make this pass; the branch is reading a vocabulary the taxonomy has already moved past.",
    ];
  }
  return [
    "but `dsh-forge init` creates no label with that name. The branch can never be true.",
    "Add a row to CORE_TAXONOMY, or delete the branch.",
  ];
}

function compare(uses, creatable) {
  const problems = [];

  for (const use of uses) {
    if (use.kind === "name") {
      if (creatable.names.has(use.literal)) continue;
      problems.push(
        problem(
          `\`${use.literal}\` is compared for equality in ${use.site} — ${use.reads} —`,
          ...missingNameTail(use.literal, creatable),
        ),
      );
      continue;
    }

    if (use.kind === "family") {
      if (creatable.prefixes.has(use.literal)) continue;
      const note = use.configurable === true
        ? " (this family's prefix is per-repository; the literal is the default)"
        : "";
      problems.push(
        problem(
          `\`${use.literal}:\` is read as a family in ${use.site} — ${use.reads}${note} —`,
          "but the taxonomy creates nothing under that prefix. Every read returns null, so the",
          "projector reports every item as having no value rather than reporting anything wrong.",
          "Add the family to the taxonomy, or stop reading it.",
        ),
      );
      continue;
    }

    const full = `${use.family}:${use.literal}`;
    if (creatable.names.has(full)) continue;
    problems.push(
      problem(`\`${full}\` is named in ${use.site} — ${use.reads} —`, ...missingNameTail(full, creatable)),
    );
  }

  return problems;
}

/**
 * The other direction, and only for families the registry claims to enumerate.
 *
 * Declaring `value` entries is a claim that these are all the values this code knows how to act
 * on. Where that claim is made it can be checked, and the failure it catches is the quiet one: a
 * `priority:p4` the taxonomy creates and `DEFAULT_PRIORITY_ORDER` has never heard of does not
 * error — it sorts to the end of every column, behind every listed priority, forever.
 *
 * Only for enumerated families. `area:`, `epic:` and the rest are open by construction: their
 * values come from the repository, and demanding the code name them all would be demanding it
 * hard-code the repository.
 */
function compareEnumerated(uses, families, creatable) {
  const problems = [];
  for (const family of families) {
    const declared = new Set(
      uses.filter((use) => use.kind === "value" && use.family === family).map((use) => use.literal),
    );
    const site = uses.find((use) => use.kind === "value" && use.family === family)?.site ?? REGISTRY;
    for (const name of creatable.names) {
      if (prefixOf(name) !== family) continue;
      const value = name.slice(family.length + 1);
      if (declared.has(value)) continue;
      problems.push(
        problem(
          `\`${name}\` is created by the taxonomy, but ${REGISTRY} enumerates the \`${family}:\``,
          `family and does not list \`${value}\`, so ${site} reads the family and has nothing to`,
          "do with this value. Nothing fails: items carrying it sort behind every listed value, in",
          "every column, and the board looks well-formed while doing it.",
        ),
      );
    }
  }
  return problems;
}

const main = async () => {
  const board = await load(BOARD_DIST, "@rickylabs/board");
  const forge = await load(FORGE_DIST, "@rickylabs/forge");

  const uses = board.LABEL_USES;
  if (!Array.isArray(uses) || uses.length === 0) {
    throw new Error(
      "@rickylabs/board exports no LABEL_USES entries. An empty registry passes every comparison " +
        "below, and a check that cannot fail is the defect it was written to find.",
    );
  }

  const lanePrefix = board.DEFAULT_LANE_PREFIX;
  const creatable = creatableFrom(forge, lanePrefix);
  const problems = [
    ...compare(uses, creatable),
    ...compareEnumerated(uses, board.ENUMERATED_FAMILIES ?? [], creatable),
  ];

  // Reported separately from the comparisons above because it is a different claim: not "the board
  // reads a label nothing creates" but "the two packages disagree about what the default is". A
  // repository that has settled on `topic:` is unaffected either way; a repository with no lane
  // labels at all gets one answer from `dsh-forge` and a different one from `dsh-board`.
  const forgeDefault = forge.detectLanePrefix([], []);
  if (forgeDefault !== lanePrefix) {
    problems.push(
      problem(
        `the two packages disagree about the default lane prefix: \`dsh-board\` uses`,
        `\`${lanePrefix}:\` and \`dsh-forge\` falls back to \`${forgeDefault}:\`. On a repository`,
        "with no lane labels yet, forge stamps one prefix and the board reads the other.",
      ),
    );
  }

  if (problems.length === 0) {
    console.log(
      `label registry ok — ${uses.length} label use(s) in @rickylabs/board are all creatable by ` +
        `@rickylabs/forge (${creatable.live} live core labels; ${creatable.retired.size} retired ` +
        "label(s) excluded)",
    );
    return 0;
  }

  console.error(`label registry check failed — ${problems.length} problem(s):\n`);
  for (const entry of problems) console.error(`  ${entry}\n`);
  console.error("One rule, read in both directions: the labels the projector acts on and the labels");
  console.error("the taxonomy creates are meant to be the same set. Neither half of a disagreement");
  console.error("fails at runtime — that is why it needs a check — so fix whichever of the two moved:");
  console.error(`${REGISTRY}, or the taxonomy in packages/forge/src/labels/taxonomy.ts.`);
  return 1;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`label registry check could not run: ${error.message}`);
  console.error("This is a broken check, not a passing one.");
  process.exitCode = 2;
}
