/**
 * The interpreter subset behind `check-tutorial.mjs`: the few shell forms a tutorial block may use,
 * turned into a plan the checker can run without a shell. See the contract and the three
 * deliberate limits at the top of `check-tutorial.mjs`; this module only parses and resolves.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Fold `\` continuations into logical lines. */
function logicalLines(body) {
  const out = [];
  let buffer = "";
  for (const raw of body) {
    const line = raw.trimEnd();
    if (line.endsWith("\\")) {
      buffer += `${line.slice(0, -1).trimEnd()} `;
      continue;
    }
    out.push(`${buffer}${line}`.trim());
    buffer = "";
  }
  if (buffer.trim()) out.push(buffer.trim());
  return out.filter((line) => line.length > 0);
}

/** Quote-aware split into tokens, keeping `|` as its own token. */
function tokenize(line) {
  const tokens = [];
  let current = "";
  let quote = null;
  let started = false;
  const push = () => {
    if (started) tokens.push(current);
    current = "";
    started = false;
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === " ") {
      push();
      continue;
    }
    if (ch === "|") {
      push();
      tokens.push("|");
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) return { error: "unbalanced quote" };
  push();
  return { tokens };
}

function expand(token, bindings) {
  return token.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, name) => {
    if (bindings.has(name)) return bindings.get(name);
    throw new Error(`\`$${name}\` is not set by this block or any block above it`);
  });
}

/**
 * Resolve a `node_modules/.bin/<name>` path to the JavaScript the shim would run.
 *
 * The shim itself is a `.CMD` on Windows and a shell script elsewhere, so spawning it directly is
 * the one thing guaranteed not to behave the same on both. Reading the owning package's `bin` field
 * is what the shim encodes anyway.
 */
function resolveBinShim(binPath) {
  const name = binPath.slice(binPath.lastIndexOf("/") + 1);
  const modules = binPath.slice(0, binPath.lastIndexOf("/.bin/"));
  const candidates = [];
  const modulesDir = join(ROOT, modules);
  if (!existsSync(modulesDir)) return { error: `\`${modules}\` does not exist — run \`pnpm install\`` };
  for (const entry of readdirSync(modulesDir)) {
    if (entry.startsWith("@")) {
      for (const scoped of readdirSync(join(modulesDir, entry))) {
        candidates.push(join(modulesDir, entry, scoped));
      }
    } else candidates.push(join(modulesDir, entry));
  }
  for (const pkgDir of candidates) {
    const manifest = join(pkgDir, "package.json");
    if (!existsSync(manifest)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
      continue;
    }
    // Both npm spellings: `"bin": "lib/cli.js"` names the binary after the package — after its
    // scope is dropped, so `@scope/tool` installs a shim called `tool` — and
    // `"bin": {...}` names each one explicitly.
    const unscoped = typeof pkg.name === "string" ? pkg.name.split("/").pop() : null;
    if (typeof pkg.bin === "string" && unscoped === name) return { script: join(pkgDir, pkg.bin) };
    if (pkg.bin && typeof pkg.bin[name] === "string") return { script: join(pkgDir, pkg.bin[name]) };
  }
  return { error: `no package under \`${modules}\` declares a \`${name}\` bin` };
}

function isAssignment(line) {
  return /^[A-Za-z_][A-Za-z0-9_]*=[^\s|]*$/.test(line);
}

/**
 * Bind the variables a bash fence sets, whether or not that fence is one we run.
 *
 * The tutorial is a sequence and its variables are document state: `$TELEMETRY_HOME` is created in
 * step 5's first block, whose output the page describes in prose rather than pasting, and read by
 * every block after it. Harvesting only from blocks that happen to have a checked output below them
 * would leave those later blocks unrunnable for a reason that has nothing to do with them.
 */
export function harvestAssignments(body, bindings, temps, placeholders) {
  for (const line of logicalLines(body)) {
    const mktemp = /^([A-Za-z_][A-Za-z0-9_]*)=\$\(mktemp -d\)$/.exec(line);
    if (mktemp) {
      const name = mktemp[1];
      if (!placeholders.has(name)) {
        return { error: `\`${name}\` has no display placeholder in check-tutorial.mjs` };
      }
      if (!bindings.has(name)) {
        const dir = mkdtempSync(join(tmpdir(), "harness-tutorial-"));
        bindings.set(name, dir);
        temps.push(dir);
      }
      continue;
    }
    if (isAssignment(line)) {
      const [, name, value] = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      bindings.set(name, value);
    }
  }
  return {};
}

/** Turn one bash fence into something runnable, or explain why it is not. */
export function planCommand(body, bindings) {
  const lines = logicalLines(body);
  let command = null;
  for (const line of lines) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=\$\(mktemp -d\)$/.test(line) || isAssignment(line)) continue;
    if (command !== null) return { unsupported: "more than one command in a single block" };
    command = line;
  }
  if (command === null) return { unsupported: "no command line in this block" };

  const lexed = tokenize(command);
  if (lexed.error) return { unsupported: lexed.error };

  const segments = [[]];
  for (const token of lexed.tokens) {
    if (token === "|") segments.push([]);
    else segments[segments.length - 1].push(token);
  }
  if (segments.length > 2) return { unsupported: "more than one pipe" };

  let stdin;
  let argvTokens = segments[0];
  if (segments.length === 2) {
    const producer = segments[0];
    // Single quotes in the page mean the token really is backslash-n, not a newline.
    if (producer[0] !== "printf" || producer[1] !== "%s\\n") {
      return { unsupported: `only \`printf '%s\\n' ...\` may feed a pipe, not \`${producer[0]}\`` };
    }
    stdin = `${producer.slice(2).join("\n")}\n`;
    argvTokens = segments[1];
  }

  const env = { ...process.env };
  let i = 0;
  for (; i < argvTokens.length; i += 1) {
    const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(argvTokens[i]);
    if (!assign) break;
    env[assign[1]] = expand(assign[2], bindings);
  }
  if (argvTokens[i] === "env") {
    i += 1;
    while (argvTokens[i] === "-u") {
      delete env[argvTokens[i + 1]];
      i += 2;
    }
  }
  const program = argvTokens[i];
  if (program === undefined) return { unsupported: "no program to run" };
  const rest = argvTokens.slice(i + 1).map((token) => expand(token, bindings));

  if (program === "node") return { script: resolve(ROOT, rest[0]), args: rest.slice(1), env, stdin };
  if (program.includes("/.bin/")) {
    const shim = resolveBinShim(program);
    if (shim.error) return { unsupported: shim.error };
    return { script: shim.script, args: rest, env, stdin };
  }
  return { unsupported: `\`${program}\` is outside the interpreter subset` };
}
