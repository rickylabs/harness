/**
 * The N5 deployment, as executable acceptance criteria.
 *
 * `deploy/compose/dsh.yaml` is hand-written rather than generated from TypeScript, against this
 * repository's usual habit, because a compose file is read by an operator at 2am and its comments
 * are half of what it is for. What generation would have bought — that the constraints are checked
 * rather than remembered — is bought here instead, and more cheaply: these are the five checkboxes
 * from E2.3 (#48), each one a failure this box has actually produced.
 *
 * The assertions are textual on purpose. Parsing the YAML would need a dependency the monorepo does
 * not have, in a package whose tests exist so that a `pnpm test` needs nothing but node — and it
 * would not make the checks stronger, because what is being asserted is the *presence or absence of
 * a key*, which reads the same either way. Where structure genuinely matters (the port block) the
 * regex spans the lines that carry it.
 *
 * @see deploy/README.md for what each constraint costs and why it is worth it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/** Repository root, from this file's built location at `packages/dsh-app/dist/`. */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Contents with line endings normalized, so a checkout on Windows asserts the same as CI. */
const read = (path: string): string =>
  readFileSync(`${repoRoot}${path}`, "utf8").replaceAll("\r\n", "\n");

const compose = read("deploy/compose/dsh.yaml");
const overlay = read("deploy/dsh/web-bind.cordis.patch.yml");

/**
 * The compose file with its comment lines removed.
 *
 * Every "this must not appear" assertion reads this rather than the raw text, because the reasons
 * those things are absent are written *in* the file — the comment explaining why `/tmp` is not a
 * tmpfs necessarily says `/ephemeral`. Asserting against the raw text would make the file's own
 * documentation the thing that fails the build, which teaches the next person to delete the
 * comment rather than keep the constraint.
 */
const composeCode = compose
  .split("\n")
  .filter((line) => !/^\s*#/u.test(line))
  .join("\n");

/** The pool the box keeps across reboots. Its opposite is `/ephemeral`, which does not. */
const POOL = "/home/rickylabs/main/syspool";

describe("the comment filter these assertions rest on", () => {
  it("keeps the keys and drops only the prose", () => {
    // Every "must not appear" check below reads composeCode, so a filter that ate too much would
    // make all of them pass by having nothing left to find. This is the check on the check.
    assert.match(composeCode, /^services:$/m, "the filter ate a top-level key");
    assert.ok(composeCode.includes("/ephemeral") === false);
    assert.ok(compose.includes("/ephemeral"), "the comment explaining the tmpfs trap went missing");
  });
});

describe("the web surface is reachable on 3080", () => {
  it("publishes the container port the web bundle binds", () => {
    assert.match(
      compose,
      /- mode: ingress\n\s+target: 3080\n\s+published: "3080"\n\s+protocol: tcp/,
      "3080 is not published in the long form the MinisCloud UI keeps",
    );
  });

  it("installs the web surface, not the default terminal one", () => {
    assert.match(compose, /install --name rickylabs-web --surface web/);
  });

  it("binds every interface through the overlay, because the flag refuses to", () => {
    // `dsh --host 0.0.0.0` is a deliberate usage error, so the bind has to come from a patch.
    assert.ok(!composeCode.includes("--host"), "the compose file tries to set the bind from argv");
    assert.match(overlay, /^- id: webserver$/m);
    assert.match(overlay, /^\s+host: 0\.0\.0\.0$/m);
    assert.match(compose, /--patch "\$\$HARNESS_REPO\/deploy\/dsh\/web-bind\.cordis\.patch\.yml"/);
  });

  it("restates the whole webserver config, because a patch replaces it", () => {
    const owned = [
      "host",
      "port",
      "compression",
      "compressionLevel",
      "compressionThresholdBytes",
    ];
    for (const key of owned) {
      assert.match(overlay, new RegExp(`^\\s+${key}:`, "mu"), `the overlay drops ${key}`);
    }
  });

  it("does not ask the container to open a browser it has not got", () => {
    assert.match(compose, /--no-open/);
  });

  it("refuses to boot without the checkout the profile links", () => {
    // The profile links `@rickylabs/dsh-app` at a path; with no checkout there, dsh would fail
    // deep in bundle resolution. Exiting 1 with the path is the failure worth having.
    assert.match(compose, /if \[ ! -d "\$\$HARNESS_REPO\/\.git" \]/);
    assert.match(compose, /exit 1/);
  });
});

describe("state lives on the pool, never on the tmpfs", () => {
  it("puts the dsh home on the persistent path", () => {
    assert.match(compose, /^\s+DSH_HOME: \/data\/dsh$/m);
    assert.match(compose, new RegExp(`source: ${POOL}/AI/dsh/data\\n\\s+target: /data$`, "mu"));
  });

  it("mounts the shared projects dir as the workspace", () => {
    assert.match(
      compose,
      new RegExp(`source: ${POOL}/AI/agents/home/projects\\n\\s+target: /workspace$`, "mu"),
    );
    assert.match(compose, /^\s+working_dir: \/workspace$/m);
  });

  it("keeps every path off /ephemeral", () => {
    assert.ok(
      !composeCode.includes("/ephemeral"),
      "/ephemeral is a noexec tmpfs on this box; a dlopen from there fails",
    );
  });
});

describe("TMPDIR can execute what it holds", () => {
  it("exports TMPDIR=/tmp", () => {
    assert.match(compose, /^\s+TMPDIR: \/tmp$/m);
  });

  it("backs /tmp with a disk bind, not a tmpfs", () => {
    assert.match(compose, new RegExp(`source: ${POOL}/AI/dsh/tmp\\n\\s+target: /tmp$`, "mu"));
    assert.doesNotMatch(
      composeCode,
      /^\s+tmpfs:$/m,
      "a tmpfs /tmp inherits noexec, and the failure names the native module rather than the mount",
    );
  });
});

describe("it shares no config tree with the desktop containers", () => {
  it("points HOME and every XDG path inside its own /data", () => {
    for (const [key, value] of [
      ["HOME", "/data/home"],
      ["XDG_CONFIG_HOME", "/data/config"],
      ["XDG_DATA_HOME", "/data/share"],
      ["XDG_CACHE_HOME", "/data/cache"],
    ] as const) {
      assert.match(compose, new RegExp(`^\\s+${key}: ${value}$`, "mu"), `${key} is not under /data`);
    }
  });

  it("mounts none of the agent session stores", () => {
    for (const shared of [".claude", ".codex", ".config/opencode", ".gemini"]) {
      assert.ok(!composeCode.includes(shared), `the stack reaches into ${shared}`);
    }
    assert.doesNotMatch(
      composeCode,
      /source: .*\/AI\/agents\/home$/m,
      "binding the agents' home would share the store ten live sessions are writing to",
    );
  });
});

describe("it uses only the compose keys the MinisCloud UI keeps", () => {
  for (const key of ["group_add", "network_mode"]) {
    it(`declares no ${key}`, () => {
      assert.doesNotMatch(
        composeCode,
        new RegExp(`^\\s*${key}:`, "mu"),
        `${key} is dropped silently`,
      );
    });
  }

  it("declares no top-level volumes block", () => {
    assert.doesNotMatch(composeCode, /^volumes:/m, "a top-level volumes: is dropped silently");
    assert.match(compose, /^\s{4}volumes:$/m, "the service-level binds went missing");
  });

  it("declares its binds in the long syntax that pins create_host_path", () => {
    const binds = composeCode.match(/^\s+create_host_path: false$/gm) ?? [];
    assert.equal(binds.length, 3, "every bind must refuse to invent its own source directory");
  });

  it("joins the shared network by external reference", () => {
    assert.match(compose, /^\s+ai-shared:\n\s+external: true\n\s+name: ai-shared$/m);
  });
});
