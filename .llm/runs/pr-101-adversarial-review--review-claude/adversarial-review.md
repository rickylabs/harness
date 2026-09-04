# Adversarial review — PR #101

## Verdict

**`FAIL_FIX`.** The package compiles and its authored tests are green, but it is not the parser
divybot executes and the projection can still lie silently. The most serious counterexample is a
rendered request whose prompt begins `model: hostile`: this package parses and validates `safe` as
the model, while divybot executes `hostile`. The board side also loses a colliding epic with no
anomaly, reports a closed-unmerged pull request as shipped, changes milestone order with host
locale, silently projects capped subsets as complete boards, and maps a network outage to the exit
code reserved for board anomalies.

Reviewed target: PR [#101](https://github.com/rickylabs/harness/pull/101) at immutable head
[`ad8ce70`](https://github.com/rickylabs/harness/commit/ad8ce70ebb4bc766b29929da825d095057265880),
against base `f9e0c08085cc6f2d7046b0b94f29d94dcb68dbf3`.

## Findings

### F-1 — Critical: prompt text can replace the model divybot launches

The package stops its key block at the first blank line and treats everything after it as prompt
([`dispatch.ts:86-153`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/dispatch.ts#L86-L153)).
The live Orchid parser instead skips blank lines while it remains in key mode, accepts every later
key-shaped line, and lets later values overwrite earlier ones
([`overrides.go:58-115`](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/overrides.go#L58-L115)).
That is the execution parser named by [issue #36](https://github.com/rickylabs/harness/issues/36).

Both actual parsers were fed this exact input:

```text
/swarm
harness: codex
model: safe
effort: high

model: hostile
Do the work
```

Evidence:

```text
node review-parser.mjs
# parseSwarm => model "safe", prompt "model: hostile\nDo the work", validateDispatch => []

GOTMPDIR=/tmp/go-build-review-103 GOCACHE=/tmp/go-cache-review-103 \
  mise x go@1.25.0 -- go test ./cmd/divybot -run '^TestReviewParserMatrix$' -count=1 -v
# divybot parseOverrides => model "hostile", prompt "Do the work"
```

This input is also exactly what `renderSwarm` emits when a legitimate prompt starts with a
key-shaped line because the writer inserts the blank separator
([`dispatch.ts:62-70`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/dispatch.ts#L62-L70)).
The package therefore approves one launch identity while the daemon executes another.

The disagreement is broader than one counterexample. A fenced-only example throws in
`parseSwarm` at the closing fence but launches in divybot; duplicate keys throw here but last-one
wins there; `agent`, `provider`, underscore keys, `codex-run`, `opencode-run`, and scaled token
values are live divybot inputs rejected here; invalid timeouts pass this package's validation but
are silently discarded by divybot. Conversely, this package accepts case-insensitive keys while
divybot ends key parsing on an uppercase key. This cannot be described as one wire format.

Disposition: define one grammar with an unambiguous prompt boundary and share or conformance-test
it against Orchid. Until Orchid changes, the writer must not emit text Orchid can reinterpret, and
the reader must not claim execution equivalence it does not have.

### F-2 — Blocking: a closed-unmerged PR is reported shipped

The adapter deliberately records `merged: false` because a closed-unmerged PR is not shipped
([`github.ts:70-77`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/github.ts#L70-L77),
[`model.ts:27-30`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/model.ts#L27-L30)).
No projection code reads that fact. Completion uses only the status phase
([`hierarchy.ts:54-74`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/hierarchy.ts#L54-L74)),
and anomaly detection has no closed-unmerged case
([`project.ts:46-106`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/project.ts#L46-L106)).

```text
node --input-type=module <closed-unmerged fixture>
# input: kind=pull-request, state=closed, merged=false, labels=[status:shipped]
# output: anomalies=[], progress={total:1,shipped:1,...}, column="shipped"

rg -n 'merged' packages/board/src
# only model.ts and github.ts; no projector or hierarchy consumer
```

Disposition: reconcile PR terminality with `merged`, emit a contradiction for an unmerged PR in a
shipped phase, and prove the abandoned-PR negative control.

### F-3 — Blocking: hierarchy identity conflicts are silently resolved

`buildHierarchy` keeps the first epic issue for a slug and discards later claimants
([`hierarchy.ts:103-109`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/hierarchy.ts#L103-L109)).
The projector's `knownEpics` is only a set, so it cannot report collisions
([`project.ts:125-133`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/project.ts#L125-L133)).

```text
node review-projection.mjs
# inputs: #31 "E6 — First", #32 "E6 — Second", task #1 with epic:e6
# slug-collision: anomalies=[]
# epicIssuesRendered=[31]
# allInputItems=[1,31,32]
```

The same path duplicates rather than drops when milestone ownership conflicts:

```text
node --input-type=module <milestone-conflict fixture>
# epic #36 milestone M1; task #1 milestone M2 and epic:e6
# anomalies=[]
# M1 renders epic #36 with []; M2 renders the same epic #36 with task #1
```

Two `epic:` or `priority:` labels are also silently first-wins through `labelValue`
([`model.ts:90-100`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/model.ts#L90-L100));
the fixture selected `epic:e6` and `priority:p3` from conflicting pairs with zero anomalies.

Disposition: represent and report hierarchy-family cardinality, duplicate slug claimants, and
cross-milestone parent conflicts. Never choose, drop, or duplicate an owner silently.

### F-4 — Blocking: hierarchy order depends on the host locale

Milestones use `localeCompare` without an explicit locale
([`hierarchy.ts:139-145`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/hierarchy.ts#L139-L145)).
The same two issues produce different status-tree bytes on two valid host locales:

```text
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 node review-locale.mjs
# {"locale":"en-US","milestones":["ä","z"]}

LC_ALL=sv_SE.UTF-8 LANG=sv_SE.UTF-8 node review-locale.mjs
# {"locale":"sv-SE","milestones":["z","ä"]}
```

`projectBoard` itself passed an independent shuffled-input byte comparison, and the only clock read
is the CLI edge's default timestamp
([`cli.ts:135-139`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/cli.ts#L135-L139)).
The hierarchy and `status` rendering do not meet the package-level determinism claim.

Disposition: specify a locale-independent lexical comparator (and tie-breakers) and test identical
serialized hierarchy output under differing locale environments.

### F-5 — Blocking: capped fetches are presented as complete boards

`fetchItems` says it fetches every issue and PR but passes a finite `--limit` independently to both
commands and returns no completeness metadata
([`github.ts:80-93`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/github.ts#L80-L93)).
No renderer states that it is showing a sample.

```text
node packages/board/dist/cli.js snapshot \
  --repo rickylabs/harness --limit 1 --at 2026-09-05T00:00:00Z | <JSON summary>
# {"items":[["pull-request",102],["issue",103]],"anomalyKinds":["no-status"]}
```

The live repository had 103 fetched items at the same instant with the default limit, but the
two-item result contains no truncation anomaly or flag. A human reading it as “the board” receives a
cleanly rendered subset without knowing anything was dropped.

Disposition: either exhaust pagination, or make completeness part of the snapshot and fail or
prominently mark every incomplete rendering. A default cap is not a completeness proof.

### F-6 — Blocking: network failure uses the anomaly exit code

The adapter maps only executable absence and auth-like text to `TransportUnavailable`; other `gh`
failures escape
([`github.ts:38-54`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/github.ts#L38-L54)).
The CLI's top-level rejection handler assigns exit 1
([`cli.ts:160-167`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/cli.ts#L160-L167)),
which its own contract reserves for anomalies
([`cli.ts:1-10`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/cli.ts#L1-L10)).

```text
REVIEW_GH_MODE=network PATH=<fake-gh>:$PATH node packages/board/dist/cli.js status --repo o/r
# raw "network unreachable" stack; exit 1
```

Absence and unauthenticated controls both exited 3 with actionable advice, and the network failure
was not silently clean. It still violates the documented machine-readable distinction.

Disposition: classify execution/network failures as transport failures with exit 3 and actionable
context; keep exit 1 exclusive to `check` finding board anomalies.

## Required checklist

### Parser

#### 1. Agreement with divybot — FAIL

Commands: `node review-parser.mjs` against built `dispatch.js`, and
`mise x go@1.25.0 -- go test ./cmd/divybot -run '^TestReviewParserMatrix$' -count=1 -v`
against `rickylabs/orchid@d344bd0`. Result: the same prompt-header input parsed `safe` here and
`hostile` in divybot. Duplicate, aliases, key case, run harnesses, timeout, and token syntax also
diverged. See F-1.

#### 2. Fenced `/swarm` — FAIL

Command: the same two-parser matrix with `fenced-only` and `benign-then-fenced-hostile` cases.
Result: when the only block was in a triple-backtick fence, `parseSwarm` threw on the closing fence;
divybot returned `harness=codex, model=hostile` and would treat it as live. With a benign block
first and hostile fenced text later, both retained the benign launch values, but this parser put the
entire hostile fence in `prompt` while divybot stopped at the opening fence and produced an empty
prompt.

#### 3. Position sensitivity — PASS with security observation

Command: matrix cases `line-1`, `line-40`, `two-blocks`, `leading-space`, `swarmy`, `blockquote`,
and `html-comment`. Result for both parsers: line 1 and line 40 accepted; first of two blocks wins;
leading whitespace accepted; `/swarmy` and blockquote rejected. Both treat a `/swarm` inside an
HTML comment as live (`model=hidden`). The comment-trigger edge separately uses prefix matching,
but the parser itself requires an exact trimmed line in Orchid
([`overrides.go:58-74`](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/overrides.go#L58-L74)).

#### 4. Line endings and whitespace — PASS except empty-value semantics

Command: matrix cases `crlf`, `mixed-endings`, `trailing-space`, `tab-separator`, and
`key-no-value`. Result: both parsed CRLF, mixed endings, trailing spaces, and tab-separated keys to
the same values. For `model:` with no value, `parseSwarm` returned an unspecified model and
validation rejected it; divybot treated that line and every later line as prompt, also leaving the
model unset. The outcomes both avoid an explicit model but the parsed prompt/effort differ.

#### 5. Duplicate and unknown keys — FAIL on duplicate equivalence

Command: matrix cases `duplicate-model`, `unknown-key`, and `prefix-key`. Result: both ignored an
unknown key and a `models:` prefix key. This parser threw on duplicate `model`; divybot selected the
later `hostile` value. That is a safe refusal locally but not wire-format agreement.

#### 6. Prompt header injection — FAIL

Command: matrix case `prompt-header-injection`. Result: `parseSwarm` kept `model: hostile` in prompt
and validation returned `[]`; divybot promoted it to the launch model. See F-1.

#### 7. `null` callers — PASS

Command: `rg -n 'parseSwarm|validateDispatch' packages/board/src --glob '!*.test.ts'`. Result:
`parseSwarm` appears only in its definition and public export; no production caller in the diff can
mistake `null` for a dispatch.

#### 8. Missing model and validation bypass — PASS in-diff, unguarded public seam noted

Command: parse `key-no-value`, call `validateDispatch`, and run the same production-caller search.
Result: validation emitted the missing-model problem, and no code in this diff executes dispatches.
`renderSwarm` itself does not call validation and the public type permits an absent model, so future
senders must not treat the validator as structural enforcement.

#### 9. Closed harness/router sets — PASS locally, FAIL for equivalence

Command: matrix cases `invalid-harness` and `invalid-router`. Result: this parser rejected values
outside `HARNESSES` and `ROUTERS`. Divybot accepted both strings; an unknown harness reaches the
default Claude launch arm, while an arbitrary router is composed into an OpenCode model
([`overrides.go:119-185`](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/overrides.go#L119-L185)).

### Projection

#### 10. Determinism — FAIL at hierarchy boundary

Commands: `node review-projection.mjs`; source scan
`rg -n 'new Date|Date.now|toLocale|localeCompare|process.env|Object.keys|Math.random' packages/board/src`;
and the two `LC_ALL=... node review-locale.mjs` runs. Result: independently shuffled inputs produced
a byte-identical `BoardSnapshot`; no projection env/random/Object.keys reads exist; the CLI reads
the clock only for its timestamp default. `buildHierarchy` uses default-locale `localeCompare` and
produced different milestone order under `en-US` and `sv-SE`. See F-4.

#### 11. `statusLabelsOf` boundary — PASS

Command: `node review-projection.mjs` with the seven specified labels. Result:
`["status:ready","status:","status:ready:extra","status:value:with:colon"]`; `statusready`,
`Status:Ready`, and bare `status` were excluded. Empty/extra-colon values are correctly identified
as members of the status family and subsequently reported unknown.

#### 12. `phaseOf` with several phases — PASS

Command: `phaseOf(["status:ready-merge","status:blocked"])`. Result: `blocked`, the earlier lifecycle
phase, regardless of label order. Earliest is a policy choice, but it is the safer one here: choosing
latest would overstate progress under contradiction. Because `multiple-status` is emitted, the
conservative placement is not silent.

#### 13. Epic self-counting — PASS

Command: hierarchy fixture where epic #36 carries both `epic` and `epic:e6`, with task #1 under
`epic:e6`. Result: progress total 1 and task list `[1]`; #36 was not in its denominator.

#### 14. Epic slugs and collisions — FAIL on collision handling

Command: `slugOfEpicTitle` over the actual titles from issues #31–#39, then the two-E6 collision
fixture. Result: all nine current titles mapped uniquely to `e1` through `e9`. Two artificial E6
titles collided and silently dropped #32 with zero anomalies. See F-3.

#### 15. Progress bar boundaries — PASS

Command: `renderBar` at width 100 for 19/20, 199/200, 999/1000, and 1/1000. Result: filled cells
were 95, 99, 99, and 0 respectively; none of the incomplete sets rendered full and the tiny set did
not invent a filled cell.

#### 16. Anomalies emitted, never repaired — FAIL

Command: one fixture exercising all six declared anomaly kinds, plus collision, milestone-conflict,
and duplicate-family fixtures. Result: all six declared kinds were emitted for their direct cases.
Duplicate epic slugs emitted none and lost an issue; cross-milestone ownership emitted none and
duplicated an epic; duplicate `epic:`/`priority:` labels emitted none and selected the first. See
F-3. The issue does not always win.

#### 17. Empty and degenerate inputs — PASS mechanically, semantic defect covered by F-2

Command: fixtures for zero issues, two closed unlabelled issues, one unlabelled open item, a
milestone with only a loose task, and a missing epic issue. Result: no crashes; empty projected zero
items/anomalies; the open unlabelled item was in `unphased`; the milestone had zero epics and one
loose task; the missing epic node retained its task and had `issue=null` with an `epic-not-found`
anomaly. Two closed unlabelled issues rolled up as `0/2 done · 2 invisible`, which follows current
phase semantics. The stronger closed-unmerged false-positive is F-2.

### Adapter and CLI

#### 18. No GitHub write path — PASS

Commands: diff scan for `gh issue edit`, `gh api -X`, mutating `--method`, `PATCH`, `label add`,
issue create/close/comment/delete, PR merge/close/comment, and Node file writers; then
`rg -n 'gh\(\[' packages/board/src/github.ts`. Result: the broad scan found only prose containing
“issue comment”; executable calls were exactly `gh issue list`, `gh pr list`, and `gh repo view`.
A counterexample would have been any mutating `gh` subcommand, non-GET API method, or write-capable
filesystem/network adapter reachable from the package. None exists.

#### 19. Credential isolation — PASS

Commands: source scan for `process.env`, token/credential access, shell execution, and process
creation; then fake-`gh` argv capture while `GH_TOKEN` remained in the environment. Result: the
adapter does not read environment variables or interpolate a command string, and
`credential-in-argv: false`. No package log or written-file path receives the token.

#### 20. Repository-slug injection — PASS for command execution

Command: `PATH=<capturing-gh>:$PATH node review-adapter.mjs` with a space, semicolon, leading
`--repo`, and `$(touch PWNED)`. Result: every slug remained one literal argv element; no shell marker
was created. Real `gh` rejected the leading-dash slug with exit 1, so it can cause an error but not
option-driven execution. `execFile` with an argument array makes shell metacharacters inert
([`github.ts:38-43`](https://github.com/rickylabs/harness/blob/ad8ce70ebb4bc766b29929da825d095057265880/packages/board/src/github.ts#L38-L43)).

#### 21. Exit codes — FAIL for network transport

Commands: invoke the built CLI with fake `gh` modes for missing, auth, network, clean, and
contradiction, plus `--unknown`. Results: clean 0; contradictory `check` 1; usage 2; missing `gh` 3
with install/auth advice; unauthenticated 3 with advice; network failure 1 with a raw stack. The
required failing gate was observed: the contradiction was an open item in terminal `shipped`, and
`check` printed `shipped-but-open` before exiting 1. See F-6 for the transport-code defect.

The live read-only commands also ran:

```text
doctor   # exit 0, reachable yes
status   # exit 0
columns  # exit 0
snapshot # exit 0: 103 items, 101 unphased, 69 anomalies at the fixed timestamp
check    # exit 1: 69 anomalies
```

#### 22. No `forge` dependency and graph gate — PASS

Commands: scan `packages/board/package.json`, `packages/board/tsconfig.json`, and source for
`@rickylabs/forge`, `../forge`, or `packages/forge`; run `pnpm run check:graph`. Result: no matches,
no manifest dependency, no TS reference, and `project graph ok — 14 packages, references match
dependencies`.

## Baseline build evidence

The host used Node 26.8.1. The exact package-manager pin was installed into a temporary prefix and
made available to root scripts:

```text
npm install --prefix /tmp/harness-pr101-tools --ignore-scripts --no-save pnpm@11.25.0
pnpm --version
# 11.25.0

pnpm install --frozen-lockfile
# exit 0

pnpm --filter @rickylabs/board test
# 81 pass, 0 fail

pnpm run typecheck
# exit 0; check:graph passed; all 14 packages passed

pnpm run build
# exit 0; check:graph passed; all 14 packages passed

git diff --check "$BASE...$HEAD"
# exit 0
```

These green gates establish buildability. They do not close the behavioral counterexamples above.
