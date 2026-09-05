# Adversarial re-review — PR #101

## Verdict

**`FAIL_FIX`.** The fix compiles and all 223 authored tests pass, but the critical prompt-to-model
substitution remains reachable through three characters the JavaScript and Go regex engines treat
differently. Three other requested properties also fail: merge-state-unknown is counted as shipped,
a displaced epic can collide with a real qualified slug and disappear, and the transport classifier
can throw while claiming to be total. The default GitHub runner only reads, but its exported
injectable runner is an unconstrained execution seam and therefore does not satisfy the stronger
no-write check in issue #107.

Reviewed target: PR [#101](https://github.com/rickylabs/harness/pull/101) at immutable head
[`4d5cc07`](https://github.com/rickylabs/harness/commit/4d5cc071b89d70a8b7895bc78cb669e717c84cf3),
against base `f9e0c08085cc6f2d7046b0b94f29d94dcb68dbf3`. The first review's six findings are recorded
in [PR #104](https://github.com/rickylabs/harness/pull/104).

## Findings

### F-1 — Critical: CR and Unicode separators still let prompt text replace the model

The writer tests prompt key-shape with JavaScript `.` and only splits on LF
([`dispatch.ts:128-163`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/dispatch.ts#L128-L163)).
JavaScript `.` does not match CR, U+2028, or U+2029. Go's RE2 `.` does match those characters; Orchid
also splits only on LF and allows later keys to overwrite earlier values
([`overrides.go:56-114`](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/overrides.go#L56-L114)).
The refusal check rejects LF but not those three characters
([`dispatch.ts:482-518`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/dispatch.ts#L482-L518)).

I fed both actual parsers the output from this request, once per separator:

```text
{ harness: "codex", model: "selected", effort: "high",
  prompt: "model: attacker<SEP>payload" }
```

Command and result from the built TypeScript package:

```text
node --input-type=module -e '<renderSwarm + parseSwarm separator matrix>'

SEP CR:    writer accepted; parseSwarm model="selected",
           prompt="model: attacker\rpayload", warnings=[]
SEP U+2028: writer accepted; parseSwarm model="selected",
            prompt="model: attacker<U+2028>payload", warnings=[]
SEP U+2029: writer accepted; parseSwarm model="selected",
            prompt="model: attacker<U+2029>payload", warnings=[]
```

Command and result from the pinned real Go function:

```text
GOTMPDIR=/tmp/harness-issue-107-go-build GOCACHE=/tmp/harness-issue-107-go-cache \
  mise x go@1.25.0 -- go test ./cmd/divybot \
  -run '^TestReview(Oracle|SeparatorAttack)$' -count=1 -v

CR:     parseOverrides model="attacker\rpayload", prompt=""
U+2028: parseOverrides model="attacker\u2028payload", prompt=""
U+2029: parseOverrides model="attacker\u2029payload", prompt=""
```

So prompt text still replaces the matrix-selected model. The same mismatch means `parseSwarm`
does not report what Orchid will execute, despite that explicit contract
([`dispatch.ts:271-390`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/dispatch.ts#L271-L390)).

I also attacked the named controls:

- A prompt exactly equal to `--- prompt ---` remained prompt.
- A normal `model: hostile` first line and `model   : hostile` were guarded before the prompt.
- LF in a value and a whitespace-only value were refused.
- An internal tab, zero-width space, and right-to-left override were preserved by both grammars and
  did not create a second key. They can be visually surprising, but I found no parser divergence.
- A raw empty-value line ended the key run in both parsers. A trailing-space-before-colon key was
  recognised and guarded.
- CR, U+2028, and U+2029 in a field value were accepted. Orchid bound the value; `parseSwarm`
  instead ended key parsing and reported the remaining keys as prompt. This is a second direct
  breach of the reader's equivalence claim.

The refusal set is therefore incomplete, not merely conservative. The fix must use a predicate with
Go's actual rune semantics for key recognition, or refuse every character on which the grammars
disagree, in both field values and the prompt guard decision.

### F-2 — Blocking: merge-state-unknown is still reported as shipped

`isShipped` treats every terminal pull request except an explicit `merged: false` as shipped
([`model.ts:127-147`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/model.ts#L127-L147)).
That collapses `merged: true` and `merged: undefined`. The exported source type deliberately permits
the latter, so the requested three-way distinction does not exist at the helper or progress layer.

```text
node --input-type=module -e '<four-item merge-state fixture>'

#1 PR merged=true:      shipped=true,  abandoned=false
#2 PR merged=false:     shipped=false, abandoned=true
#3 PR merged=undefined: shipped=true,  abandoned=false
#4 issue:               shipped=true,  abandoned=false
progress: total=4, shipped=3, abandoned=1, inFlight=0
```

The buckets are disjoint and sum to four, and an issue is never abandoned, but the unknown PR is in
the shipped bucket rather than a distinct residual state. The renderer does show the new category:
the same fixture rendered `3/4 done · 1 abandoned`, because `renderProgress` explicitly draws it
([`render.ts:25-36`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/render.ts#L25-L36)).
The false shipped count remains the blocker.

### F-3 — Blocking: the qualified loser namespace collides with real epic slugs

The lowest issue number does win a duplicated slug independently of fetch order, and three ordinary
claimants produce one winner plus two qualified losers. But qualification is plain
`${slug}#${issueNumber}`
([`hierarchy.ts:123-163`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/hierarchy.ts#L123-L163)).
The same map is also keyed by real, unconstrained `epic:` values; insertion skips an occupied key,
and lookup prefers the real winner over the displaced item
([`hierarchy.ts:186-213`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/hierarchy.ts#L186-L213)).

```text
node --input-type=module -e '<epics #30/#41/#42 claim e6; #50 claims e6#41>'

input epics:       [30,41,42,50]
anomaly:           3 epic issues claim e6; winner #30; losers #41, #42
rendered nodes:    e6 -> #30, e6#41 -> #50, e6#42 -> #42
missing from tree: #41
reversed input:    byte-identical result, still missing #41
```

The anomaly claims both losers are drawn, but #41 is not. The tiebreak is deterministic, and issue
numbers make loser-vs-loser keys unique, but the namespace is not total because a real slug can
equal a synthetic one. The outcome is fetch-order independent and still wrong.

### F-6 — Blocking: `transportFailure` is not total

The default runner now wraps ordinary `execFile` failures as transport failures, which closes the
original network-outage path. The exported classifier nevertheless accesses `error.message`
directly whenever `error instanceof Error`
([`github.ts:47-63`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/github.ts#L47-L63)).
An `Error` subclass can make that getter throw.

```text
node --input-type=module -e '<transportFailure matrix>'

string:                  TransportUnavailable
undefined:               TransportUnavailable
null:                    TransportUnavailable
plain object with a
  throwing message getter: TransportUnavailable (getter not invoked)
TypeError subclass:      TransportUnavailable
AggregateError:          TransportUnavailable
Error subclass with a
  throwing message getter: THREW "message getter exploded"
```

The function's `unknown -> TransportUnavailable` claim is false. The five CLI exit classes are
otherwise disjoint in actual processes:

```text
node packages/board/dist/cli.js --help                         -> 0
REVIEW_GH_MODE=anomaly   ... cli.js check --repo o/r           -> 1
node packages/board/dist/cli.js --bogus                        -> 2
REVIEW_GH_MODE=transport ... cli.js status --repo o/r          -> 3
REVIEW_GH_MODE=internal  ... cli.js status --repo o/r          -> 4
```

The exit-1 fixture was an open issue labelled `status:shipped`; the exit-3 fixture made fake `gh`
exit nonzero with `network unreachable`; the exit-4 fixture returned a malformed item. These are
observed process statuses, not `main()` return values. CLI routing is at
[`cli.ts:162-207`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/cli.ts#L162-L207)
and its rejection boundary assigns 4
([`cli.ts:227-239`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/cli.ts#L227-L239)).

### Regression — the injectable runner weakens the no-write boundary

The default runner uses `execFile` with an argv array and is only called with `gh issue list`,
`gh pr list`, and `gh repo view`
([`github.ts:66-84`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/github.ts#L66-L84),
[`github.ts:141-168`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/github.ts#L141-L168)).
A whole-package grep found no executable GitHub write command.

But `GhRunner` is exported, both exported adapter functions accept it, and the package root
re-exports the type. It is an arbitrary callback returning a promise, so the package invokes
caller-supplied code twice during `fetchItems`; TypeScript cannot constrain that callback to reads.
The requested property was not merely that the default is read-only, but that no exported type lets
a caller smuggle in a write. This public seam fails that property
([`github.ts:72-72`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/github.ts#L72),
[`index.ts:76-77`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/index.ts#L76-L77)).

## Six-finding closure matrix

### F-1 — FAIL

Commands: built-package writer/parser matrix and the pinned Orchid Go test shown above. Result: all
three separator attacks were accepted without a guard; Orchid replaced `selected`, while
`parseSwarm` reported it survived. The critical finding remains open.

### Conformance corpus independence — PASS for all 29 stated cases, incomplete as a proof

Command:

```text
GOTMPDIR=/tmp/harness-issue-107-go-build GOCACHE=/tmp/harness-issue-107-go-cache \
  mise x go@1.25.0 -- go test ./cmd/divybot -run '^TestReviewOracle$' -count=1 -v
```

The temporary Go oracle extracted only the 29 input bodies—not the expected objects—from
`dispatch.conformance.test.ts`, called Orchid's private `parseOverrides` in its own package, and
printed the real `Overrides` JSON. I independently matched all 29 results to the stated expectations
and re-derived `executes` from Orchid's `buildAgentCmd` switch
([`overrides.go:118-185`](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/overrides.go#L118-L185)).

Confirmed cases, in order: ordinary dispatch; blank-line model replacement; several blank lines and
absorbed keys; first non-key ends key run; uppercase key; empty value; leading-space key; dotted
key; underscore normalisation; first `#`; comment-only value; `#` in prompt; `agent`/`provider`
aliases; field case rules; scaled max-tokens; valid timeout; invalid timeout; non-positive timeout;
unknown key; fence truncation; fenced block; indented fence; prompt edge trimming; first `/swarm`;
unknown harness; absent harness; `-run` seam; `agy`; empty block.

Confirmed: **29/29. Unconfirmed: none.** These cases are independent evidence because their oracle
was the pinned Go implementation, not this package's output. They are not complete evidence of
equivalence: the CR/U+2028/U+2029 counterexamples are absent from the corpus and expose the shared
assumption that the two regex literals mean the same thing.

### F-2 — FAIL

Command: the four-item fixture shown above. Result: merged and unknown PRs both returned
`shipped=true`; closed-unmerged returned `abandoned=true`; the issue was never abandoned. Buckets
were disjoint and summed to total, and `abandoned` was visible in `renderHierarchy`, but the
required three-way classification failed.

### F-3 — FAIL

Command: four-epic fixture in forward and reverse order. Result: lowest number won and output was
order-independent, but loser #41 disappeared when its synthetic `e6#41` key collided with the real
slug `e6#41`. Three claimants alone have unique loser keys; a real qualified-looking slug breaks the
scheme.

### F-4 — PASS

Commands:

```text
grep -RInaE --exclude-dir=dist --exclude-dir=node_modules \
  'localeCompare\s*\(|toLocaleString\s*\(|\bIntl\b|\.sort\([[:space:]]*\)' packages/board
node --input-type=module -e '<comparator cross-product>'
```

No production call to `localeCompare`, `toLocaleString`, `Intl`, or bare `.sort()` remains. The one
bare `.sort()` match is in `render.test.ts:257`, sorting a test's string expectation; default string
sort is itself UTF-16 code-unit order and cannot affect package output. Cross-product checks over
`null`, empty strings, ASCII, accented text, U+2028/U+2029, an astral pair, and lone high/low
surrogates returned `antisymmetric=true` and `transitive=true`; `null` sorted last. The comparator
implementation is the promised host-independent total order
([`order.ts:14-25`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/order.ts#L14-L25)).

### F-5 — PASS_WITH_NOTES

Command: fake `gh` returned exactly one clean issue under `--limit 1`; each built CLI command ran as
an actual process with stdout/stderr captured separately.

```text
status:   exit 0, banner stdout=1 stderr=1
columns:  exit 0, banner stdout=1 stderr=1
snapshot: exit 0, banner stdout=0 stderr=1, stdout parsed as JSON
check:    exit 1, banner stdout=1 stderr=1
snapshot completeness.capped=["issue"], anomalies=["incomplete-fetch"]
```

This closes the unsafe false-negative: a capped board is never cleared by `check`, and snapshot JSON
stays parseable. The suspicion is not always right. When the repository has exactly `limit` items
and nothing was withheld, the same code falsely prints `INCOMPLETE`, records that the board “is a
prefix of the real one,” and makes `check` fail. The adapter documents this as suspicion
([`github.ts:126-162`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/github.ts#L126-L162)),
but the renderer asserts it as fact
([`render.ts:39-53`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/render.ts#L39-L53)).
That conservative false positive is a note, not a reopening of the original silent-truncation defect.

### F-6 — FAIL on totality; PASS on the original network path and exit separation

Commands: `transportFailure` hostile-value matrix and five actual CLI processes shown above. Result:
ordinary strings, nullish values, a plain throwing-getter object, `TypeError`, and `AggregateError`
were classified; an `Error` subclass with a throwing getter escaped. A default-runner network error
exited 3, and all five documented statuses were distinct.

## Previously passing controls, re-run

Command: one independent built-package fixture covering all controls. Results:

```text
shuffled projectBoard snapshots: byte-identical
shuffled hierarchies:            byte-identical
statusLabelsOf boundary:         status:ready, status:, status:ready:extra,
                                 status:value:with:colon only
phaseOf(ready-merge, blocked):    blocked
epic #36 + task #1:              total=1, tasks=[1]
renderBar width=100:
  19/20 -> 95 cells; 199/200 -> 99; 1/1000 -> 0; none full
empty board:                     zero milestones, zero progress
two closed unlabelled issues:    total=2, invisible=2, no crash
missing epic issue:              issue=null, tasks=[7], no crash
```

All previously passing controls still hold.

## Adapter, injection, graph, and live-read checks

### No-write scan — FAIL only at the exported callback boundary

Command:

```text
grep -RInaE --exclude-dir=dist --exclude-dir=node_modules \
  'issue edit|pr edit|api[[:space:]]+-X|--method|\bPOST\b|\bPATCH\b|label add|comment' \
  packages/board
```

Only prose/tests about comments matched. Executable default calls were the three read paths named
above. The public arbitrary `GhRunner` callback fails the additional type-boundary requirement.

### Repository-slug injection — PASS

Command: actual built CLI with a capturing fake `gh`, using repo slug
`owner/repo; touch /tmp/harness-issue-107-pwned; $(id)`. Result: the entire slug was one argv element
after `--repo`; the marker was not created. Real `gh issue list --repo --help ...` exited 1 with
`expected the "[HOST/]OWNER/REPO" format, got "--help"`, proving a leading-dash slug is consumed as
the value of `--repo`, not reinterpreted as an option. `execFile` and the argument array are visible
at [`github.ts:74-79`](https://github.com/rickylabs/harness/blob/4d5cc071b89d70a8b7895bc78cb669e717c84cf3/packages/board/src/github.ts#L74-L79).

### Forge isolation and graph — PASS

Commands:

```text
grep -RInaE --exclude-dir=dist --exclude-dir=node_modules \
  '@rickylabs/forge|packages/forge|\.\./forge' packages/board
node scripts/check-project-graph.mjs
```

The grep had no matches. The graph gate reported
`project graph ok — 14 packages, references match dependencies`.

### Live read-only CLI — PASS

Commands: built `doctor`, `status`, `columns`, `snapshot`, and `check` against
`rickylabs/harness`, with snapshot timestamp `2026-09-05T00:00:00Z`. Results: 0, 0, 0, 0, and 1.
Snapshot stdout parsed as JSON with 109 items, no capped kinds, and 81 anomalies; `check` reported
those anomalies rather than clearing the board.

## Attacker-controlled parser cost

Command: Node 26.8.1, built `parseSwarm`, `performance.now()`, each requested body generated in
memory. Results:

```text
10 MiB, ~5.2m short prompt lines: 169.706 ms, +208.8 MiB heap
one 10 MiB line:                  14.487 ms, +10.0 MiB heap
100000 /swarm lines:               6.907 ms,  +9.5 MiB heap
3 MiB nested-looking delimiters:   1.495 ms,  +5.8 MiB heap
10 MiB KEY_LINE near miss:         16.735 ms, +10.0 MiB heap
10 MiB KEY_LINE huge key:           9.680 ms, +30.0 MiB heap
10 MiB of unknown key lines:     1346.566 ms, 2,621,439 warnings,
                                 697.9 MiB RSS / 582.8 MiB heap
```

I found no minute-scale regex backtracking or nesting sensitivity. I did find unbounded warning
amplification: a 10 MiB key-heavy input allocates about 698 MiB. That is a resource-exhaustion risk
for a daemon parsing concurrent or otherwise unbounded text, although it is not the pathological
regex failure the check anticipated. Bound accepted body size and/or warning count before exposing
this parser to a source that does not enforce a smaller limit.

## Build evidence

The exact package-manager pin was installed outside the checkout. At the reviewed head:

```text
npm install --prefix /tmp/harness-issue-107-tools --ignore-scripts --no-save pnpm@11.25.0
PATH=/tmp/harness-issue-107-tools/node_modules/.bin:$PATH pnpm install --frozen-lockfile
# exit 0

pnpm --filter @rickylabs/board test
# 223 pass, 0 fail

pnpm run check:graph
# project graph ok — 14 packages, references match dependencies

pnpm run typecheck
# exit 0; all 14 packages

pnpm run build
# exit 0; all 14 packages

git diff --check origin/main...HEAD
# exit 0
```

These gates establish buildability. They do not close the independent counterexamples above.
