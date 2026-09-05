# Adversarial review — PR #98

## Verdict

**`FAIL_FIX`.** The no-delete invariant survived every attempted counterexample, the stateful CLI
fixture was idempotent, and the clean build, typecheck, graph, and 57 authored tests pass. Four
blocking failures remain:

1. `init --dry-run` wrote `.github/labels.yml` and sent 28 label mutations.
2. Two distinct long epic titles collapsed to one slug and detection silently dropped the second.
3. `violatesSingleStatus` accepted both zero status labels and a mixed-case pair of status labels.
4. `labels check` returned 0 for a labels file that its own parser marked invalid.

Invalid and empty colors also pass parsing and reach the transport, so malformed input can fail only
after an apply has begun. These are implementation failures, not missing environmental evidence.

Reviewed target: PR [#98](https://github.com/rickylabs/harness/pull/98) at immutable head
[`0a6dfe7`](https://github.com/rickylabs/harness/commit/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256),
against base `f9e0c08085cc6f2d7046b0b94f29d94dcb68dbf3`.

## Findings

### F-1 — Blocking: `init --dry-run` performs both kinds of label mutation

The CLI advertises `--dry-run` for `init`
([`cli.ts:46-52`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/cli.ts#L46-L52)),
but `cmdInit` passes that flag only to skill installation. It calls `cmdEject` and `cmdApply`
unconditionally
([`cli.ts:325-341`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/cli.ts#L325-L341)).

Command: a `node --input-type=module` fixture imported `main`, replaced `fetch` with a stateful
in-memory GitHub REST transport, created an empty temporary repository, and ran:

```js
await main([
  "init", "--dry-run", "--repo", "owner/repo",
  "--cwd", scratchRoot, "--no-detect", "--json",
]);
```

Result:

```json
{"exit":0,"labelMutations":28,"labelsFileWritten":true,"skillFileWritten":false,"remoteLabels":28}
```

Disposition: thread one dry-run contract through eject, apply, and skill installation. Re-run this
negative control and require zero transport mutations and zero written files.

### F-2 — Blocking: truncation collisions silently merge distinct epics

`slugify` truncates to 40 characters without a disambiguating suffix
([`taxonomy.ts:177-199`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/taxonomy.ts#L177-L199)).
Epic detection then uses a `Set` and silently skips a later matching slug
([`detect.ts:254-260`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/detect.ts#L254-L260)).

Command:

```js
const a = "a".repeat(40) + "-first-epic";
const b = "a".repeat(40) + "-second-epic";
slugify(a) === slugify(b);
await detectRepoLabels({
  repoRoot: scratchRoot,
  repo: "owner/repo",
  transport: fakeTransport([
    { number: 501, title: a, labels: ["epic"] },
    { number: 502, title: b, labels: ["epic"] },
  ]),
  existing: [], families: ["epic"],
});
```

Result: both titles produced `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; detection returned only
`epic:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` for issue #501, with no note that #502 vanished.

Disposition: make truncated slugs collision-resistant and surface any remaining collision as a
conflict. A second epic may never disappear behind first-wins de-duplication.

### F-3 — Blocking: the status helper does not enforce exactly one status

The taxonomy says the board column requires exactly one status
([`taxonomy.ts:41-55`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/taxonomy.ts#L41-L55)),
but the helper filters case-sensitively and reports only counts greater than one
([`taxonomy.ts:206-212`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/taxonomy.ts#L206-L212)).

Command:

```js
[
  [],
  ["status:impl"],
  ["status:impl", "status:ready-merge"],
  ["statuspage:outage", "type:fix"],
  ["Status:impl", "status:ready-merge"],
].map(violatesSingleStatus);
```

Result:

```json
[[],[],["status:impl","status:ready-merge"],[],[]]
```

Zero is therefore indistinguishable from a valid item, and case variation hides a real pair even
though the planner itself matches GitHub label names case-insensitively
([`plan.ts:65-75`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/plan.ts#L65-L75)).

Disposition: return a result that can represent `missing` and `multiple`, normalize case before
classification, and keep `statuspage:*` outside the status family.

### F-4 — Blocking: parse errors are notes, not gates

`ParsedLabelsFile.issues` explicitly says a non-empty list requires the caller to refuse apply
([`file.ts:52-60`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/file.ts#L52-L60)).
Resolution instead adds those issues to informational notes and keeps the parsed rows in `desired`
([`cli.ts:110-135`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/cli.ts#L110-L135));
`cmdCheck` examines only the label plan
([`cli.ts:224-233`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/cli.ts#L224-L233)).

Command: write this scratch `.github/labels.yml`, provide matching core plus `custom:ok` labels from
the in-memory REST fixture, then invoke the real CLI entry point:

```yaml
- name: custom:ok
  color: "aabbcc"
  description: "desired"
  aliases: [legacy]
```

```js
await main([
  "labels", "check", "--repo", "owner/repo",
  "--cwd", scratchRoot, "--no-detect", "--json",
]);
```

Result: the parser produced `line 4: ignoring unsupported key aliases`, while `labels check`
returned 0 with `create=0`, `update=0`, `conflict=0` and printed no parse issue.

Disposition: make every labels-file parse issue a hard preflight failure for plan, check, apply, and
init. Add both a failing check control and an assertion that apply sends no request.

### F-5 — Narrow: invalid colors cross the validation boundary

The public type promises six hex digits
([`taxonomy.ts:32-38`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/taxonomy.ts#L32-L38)),
but `normalizeColor` only removes `#` and lowercases
([`taxonomy.ts:201-204`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/taxonomy.ts#L201-L204)).
The file parser records no issue before constructing a `LabelSpec`
([`file.ts:73-85`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/file.ts#L73-L85)).

Command: parse and apply scratch rows with colors `not-a-color` and the empty string through the
real CLI entry point and an in-memory REST recorder.

Result: parse issues were `[]`; both exact invalid values reached POST request bodies and the fake
transport accepted them. The boundary forms behaved as follows:

```text
#FBCA04 -> fbca04
FBCA04  -> fbca04
fbca04  -> fbca04
not-a-color -> not-a-color
<empty> -> <empty>
```

Disposition: validate `^[0-9a-f]{6}$` before planning or transport, and fail before the first write.

## Required checklist

All mutable CLI scenarios used temporary directories plus an in-memory replacement for the REST
transport. No command targeted `rickylabs/harness`, and the reviewed worktree remained clean.

### 1. `planLabels` never deletes — PASS, with attempted counterexamples

Command: `node --input-type=module` imported `planLabels` and fed these exact states:

```text
ejected file desired: [type:feat]
repository existing:  [type:feat, status:legacy, area:old]

later detection desired: []
repository existing:    [area:forge]

foreign-only desired:  []
repository existing:   [bug, help wanted, custom:one]
```

Result: the first plan contained only `keep:type:feat`; the other two contained no actions. Omitted,
vanished, and foreign labels appeared only in `unmanaged`. The action union contains no delete kind
and apply executes only create/update
([`plan.ts:15-29`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/plan.ts#L15-L29),
[`apply.ts:27-37`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/apply.ts#L27-L37)).
A static grep found no delete transport or call site.

### 2. `violatesSingleStatus` boundaries — FAIL

Command/result: the five-array probe in F-3 covered zero, one, two, a non-status name beginning with
`status`, and mixed case. One and `statuspage:*` behaved correctly; zero and mixed case did not.

### 3. `slugify` / 40-character maximum — FAIL

Command: call `slugify` with `Crème brûlée 東京`, `🧪🚀`, `"x".repeat(400)`, `!!! ... ???`, and the
two collision titles from F-2.

Result: `cr-me-br-l-e`, empty, 40 `x` characters, empty, then the same 40 `a` characters twice.
Length is bounded, but distinct long titles collide and non-ASCII-only titles disappear. F-2 is the
blocking collision.

### 4. `epicSlug` against repository epics — PASS for the live corpus

Commands:

```sh
for n in 31 32 33 34 35 36 37 38 39; do
  gh issue view "$n" --repo rickylabs/harness --json number,title,state,url
done
```

Then a Node probe passed each live title to `epicSlug`. Issue #99 says six, but the live range has
nine open epic-labelled issues: [#31](https://github.com/rickylabs/harness/issues/31),
[#32](https://github.com/rickylabs/harness/issues/32), [#33](https://github.com/rickylabs/harness/issues/33),
[#34](https://github.com/rickylabs/harness/issues/34), [#35](https://github.com/rickylabs/harness/issues/35),
[#36](https://github.com/rickylabs/harness/issues/36), [#37](https://github.com/rickylabs/harness/issues/37),
[#38](https://github.com/rickylabs/harness/issues/38), and [#39](https://github.com/rickylabs/harness/issues/39).
The results were `e1` through `e9`, matching the identifiers a human would grep.

### 5. `detectLanePrefix` tie and zero — PASS

Command/result:

```text
[topic:docs, lane:n5]       -> topic
[orchestrator:a, topic:a]   -> orchestrator
[]                          -> lane
```

Both tied arrays were also reversed in the authored suite, which passed at this head
([`detect.test.ts:164-193`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/detect.test.ts#L164-L193)).

### 6. `normalizeColor` boundaries — FAIL validation

Command/result: the five inputs and exact outputs are recorded in F-5. The three valid forms
normalize correctly; invalid and empty strings are not rejected.

### 7. Transport selection and credential containment — PASS

Command:

```sh
env -u GITHUB_TOKEN -u GH_TOKEN PATH=/definitely-no-gh \
  /usr/local/bin/node packages/forge/dist/cli.js labels check \
  --repo owner/repo --cwd /tmp --no-detect
```

Result: exit 3 with `gh is not on PATH; no GITHUB_TOKEN or GH_TOKEN in the environment`, followed by
actionable installation/export guidance and the two commands that remain available.

A canary-token run forced the REST fallback, replaced `fetch` in memory, captured all output,
inspected `process.argv`, and scanned the scratch fixture. Result:

```json
{"inArgv":false,"inCapturedOutput":false,"inWrittenFile":false,"fixtureEntries":[]}
```

Static scans found no credential signature and only one token interpolation: the Authorization
header in the REST closure. `gh` arguments carry label data but no token
([`github.ts:82-110`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/github.ts#L82-L110),
[`github.ts:128-145`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/github.ts#L128-L145),
[`github.ts:194-214`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/labels/github.ts#L194-L214)).

### 8. `installSkill` on-disk states — PASS

Command: a Node fixture created three temporary repositories and called both the CLI and
`installSkill` directly.

Result: the CLI reported `created` then `unchanged`; a hand-written file reported `foreign` and
remained byte-identical; a changed generated file reported `stale` under `dryRun: true`, stayed
untouched, then reported `updated` on the real run and was refreshed. These match the state branches
in [`install.ts:58-110`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/forge/src/skill/install.ts#L58-L110).

### 9. Apply/check/skill idempotency and a failing drift control — PASS

Command: invoke `main(["labels", "apply", ...])` twice against the same stateful in-memory REST
fixture, invoke `labels check`, remove the `breaking` label from fixture state, invoke check again,
and invoke `skill install` twice in a scratch directory.

Result:

```json
{
  "firstApplyExit": 0,
  "createsAfterFirst": 28,
  "secondApplyExit": 0,
  "secondAdded": 0,
  "secondPlan": {"applied":[],"conflicts":[],"failed":null},
  "cleanCheckExit": 0,
  "removedForDrift": "breaking",
  "driftCheckExit": 1,
  "driftCounts": {"create":1,"update":0,"keep":27,"conflict":0},
  "skillOutcomes": ["created","unchanged"]
}
```

This is the required observed failure of the drift gate, not merely a clean demonstration.

### 10. Workspace graph and forge edge — PASS, with wording caveat

Commands:

```sh
export PATH="$TOOL_DIR/node_modules/.bin:$PATH"
pnpm run check:graph
node <structural assertion over forge and dsh-app manifests/tsconfigs>
```

Result: `project graph ok — 14 packages, references match dependencies`. The consumer edge is
declared as `@rickylabs/forge: workspace:*` in `dsh-app`
([`dsh-app/package.json:25-39`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/dsh-app/package.json#L25-L39))
and mirrored by `../forge`
([`dsh-app/tsconfig.json:10-23`](https://github.com/rickylabs/harness/blob/0a6dfe79af4ba30bab4946a62d5cfdbfd0be6256/packages/dsh-app/tsconfig.json#L10-L23)).
`packages/forge` itself declares zero outgoing workspace dependencies and zero project references;
there is therefore no mismatched edge. Issue #99 does not name an outgoing target, so the literal
reading that forge must add one cannot be verified without inventing architecture.

## Full clean gates

The host had Node 26.8.1 and no global pnpm. The exact committed pin was installed into an ephemeral
prefix, and its bin directory was added to `PATH` because the graph command performs a nested pnpm
dependency check:

```sh
npm install --prefix "$TOOL_DIR" --ignore-scripts --no-save pnpm@11.25.0
export PATH="$TOOL_DIR/node_modules/.bin:$PATH"
pnpm install --frozen-lockfile
pnpm run clean
pnpm run typecheck
pnpm run clean
pnpm run build
pnpm --filter @rickylabs/forge test
git diff --check origin/main...HEAD
```

Result: all commands exited 0; the forge suite reported 57/57 passing. The independent negative
controls above demonstrate why those authored tests do not clear the review findings.
