# Plan — docs-public-boundaries--e10

## Summary

Correct the public docs without changing runtime policy. Keep Node 24 as the declared and recommended
baseline, attribute the one Node 22.20.0 result to issue #212 as historical owner testing at
`4ff50fe`, and remove the promise that installs below 24 fail. State that the tutorial's
commands target a POSIX shell; mention the versioned Windows owner check only as historical evidence,
not universal support. Re-run every local output example in unique temporary homes, label executed
transcripts and source-derived illustrations differently, and explicitly normalize printed paths.
Replace private consumer identity and feature text in the five audited tracked files with unnamed
provenance while retaining the published-contract boundary.

**State: locked for independent Claude Opus 5 medium review. Product-document mutation remains
blocked.** Stage G must record `PASS` before implementation
([`doctrine/WORKFLOW.md:71-90`](../../../doctrine/WORKFLOW.md)).

## Decisions

### D1 — Document Node 24 as the declared and recommended baseline

Keep the README badge and prerequisite aligned with `package.json`'s `node >=24`, and describe Node 24
as the supported documentation baseline. Replace the tutorial's guaranteed-failure wording with one
tightly attributed sentence: owner testing recorded on #212 at `4ff50fe` completed
install/build/test under pnpm 11 and Node 22.20.0 after an engine warning. Call it a version-specific
historical observation rather than a general pnpm behavior, baseline, guarantee, or recommendation
([`package.json:8-10`](../../../package.json),
[`docs/tutorials/01-from-clone-to-board.md:55-58`](../../../docs/tutorials/01-from-clone-to-board.md),
[#212](https://github.com/rickylabs/harness/issues/212)).

Rejected alternative: add `engine-strict=true`. The authorized lane is documentation correction,
and changing install admission would be a new product policy with compatibility effects.

### D2 — Bound the tutorial to POSIX syntax and version the Windows evidence

Add POSIX shell to the tutorial and tutorial-index prerequisites because the page uses POSIX path,
assignment, continuation, and pipe syntax. State precisely that owner testing on Windows at
`4ff50fe` covered build/tests, the offline profile/telemetry path, and read-only forge doctor; it did
not cover the write half of step 2 or step 3. The commands shown on this page require POSIX syntax and
need translation for PowerShell/cmd. Do not use “all platforms,” “Windows supported,” or equivalent
future-facing language
([`docs/tutorials/01-from-clone-to-board.md:242-270`](../../../docs/tutorials/01-from-clone-to-board.md),
[`docs/tutorials/README.md:9-14`](../../../docs/tutorials/README.md),
[#212](https://github.com/rickylabs/harness/issues/212)).

Rejected alternative: add a parallel PowerShell tutorial. It would require a second fully executed
path and is outside this bounded correction.

### D3 — Give every output-like block an explicit evidence class

Use two visible labels in the tutorial:

1. **Executed transcript**, carrying the tested commit and runtime context in a nearby note. Apply it
   only to output freshly produced by the local profile install/dump/check and telemetry
   where/record/runs/why commands.
2. **Illustrative output**, explicitly saying it is source-derived and was not executed against a
   live GitHub repository. Apply it to healthy-board and anomaly examples and any other output-shaped
   GitHub prose.

Command fences remain instructions, not receipts. Update the docs and tutorial authoring rules so
future hand-written examples must declare this distinction instead of claiming that every command in
every tutorial was executed ([`docs/README.md:32-42`](../../../docs/README.md),
[`docs/tutorials/README.md:31-40`](../../../docs/tutorials/README.md)).

Rejected alternative: build a pasted-output checker. The coordinator selected the addendum's
explicitly permitted honest-boundary option, and a parser/runner would expand this prose correction
into new tooling.

### D4 — Execute local examples in unique homes and normalize only machine-specific paths

Change step 4 and step 5 to create separate homes with `mktemp -d`, store them in descriptive shell
variables, pass those variables to every `--home`, and scope `DSH_HOME` only to the profile dump.
Run each telemetry command through `env -u` for `DSH_TELEMETRY_DIR`, `DSH_TELEMETRY_ARCHIVE`,
`DSH_TELEMETRY_MAX_BYTES`, and `DSH_TELEMETRY_GENERATIONS`; do not read those variables. Include a
safe cleanup for only the two freshly created directories.

In displayed transcripts replace the random profile home, random telemetry home, and absolute
checkout path with the fixed display placeholders `/tmp/dsh-home`, `/tmp/tel-home`, and
`/path/to/harness`, matching [`local-example-receipts.md`](local-example-receipts.md). Say immediately
above the first transcript that these are deliberate placeholders, not the directories used; do not
silently edit any other byte of executed output. Keep the raw-to-normalized comparison, baseline
commit, Linux runtime, Node version, pnpm version, command, exit code, and stdout in
`local-example-receipts.md`, excluding the full profile dump except for the excerpt printed in the
tutorial. The explicit home is mandatory
because telemetry otherwise defaults to the current user and its overrides can redirect storage
([`packages/telemetry/src/cli.ts:91-128`](../../../packages/telemetry/src/cli.ts)).

Rejected alternative: retain reusable fixed `/tmp` directories. Pre-existing state can change
install/check and telemetry results, defeating the meaning of a fresh transcript.

### D5 — Redact current tracked copies without rewriting history

Edit exactly the five audited files containing private consumer details. Replace identities, links,
roles, and feature descriptions with generic language such as “private external consumers” or the
owner-approved provenance “a cockpit and a mobile client we run against it.” Keep only the public
architectural consequence: consumer UI is outside this repository and contracts cross the boundary
through the published package. In the historical review, preserve that the boundary correction was
verified but remove external identities, role descriptions, and repository-resolution claims
([`AGENTS.md:101-111`](../../../AGENTS.md),
[`README.md:253-259`](../../../README.md),
[`docs/concepts/01-what-this-is.md:27-37`](../../../docs/concepts/01-what-this-is.md),
[`packages/netscript-bridge/README.md:24-30`](../../../packages/netscript-bridge/README.md),
[`m1 review:20-24`](../../m1-dsh-coordinator--orchestration/reviews/pr-190-glm.md)).

Rejected alternative: rewrite commits that first introduced the text. The requested boundary covers
current tracked public text, and repository history is explicitly out of scope.

### D6 — Preserve the landed forge and board semantics and repair one stale synthesis sentence

Edits around tutorial setup and README architecture must retain all current claims about the #229
checkout guard, the #228 skipped-transport/refused-label exit behavior, and the #230 anomaly/detail/
fetch-coverage projection. Correct the tutorial's later synthesis that currently says every non-zero
`init` means refusal or conflict: after #229, exit `2` also covers a checkout/repository mismatch or
malformed invocation, while label refusal/conflict remains exit `1`. No other sentence may weaken or
broaden those contracts
([`docs/tutorials/01-from-clone-to-board.md:60-81`](../../../docs/tutorials/01-from-clone-to-board.md),
[`docs/tutorials/01-from-clone-to-board.md:116-167`](../../../docs/tutorials/01-from-clone-to-board.md),
[`README.md:142-153`](../../../README.md), [`README.md:270-279`](../../../README.md)).

## Owner forks

None. The addendum permits the honest-boundary mechanism and asks this lane to settle the Node and
platform claims; the coordinator selected the conservative, versioned attribution above. The owner
authorized removal of private consumer details and fixed the model routing. This plan does not infer
a new compatibility or support policy.

## Spikes

None. The local examples can be executed at the current baseline, and live GitHub examples are
deliberately classified as illustrations rather than promoted to receipts.

## Exact implementation manifest

1. `README.md`
   - call Node 24 the declared/recommended baseline and avoid implying default pnpm enforces it;
   - replace all private-consumer detail with unnamed provenance and the published-contract boundary;
   - preserve the #230 projection language and existing #212 admission about prose output.
2. `docs/tutorials/01-from-clone-to-board.md`
   - add POSIX-shell scope and the versioned #212 Node/Windows observations;
   - correct the unsupported-engine failure guidance;
   - replace fixed profile/telemetry homes with unique variables, clear all four telemetry overrides,
     and clean up only those created homes;
   - label all output-like blocks as executed/normalized transcripts or unexecuted illustrations;
   - preserve the #229 guard and #228 exit-code passages, while adding the #229 exit-2 case to the
     stale later “non-zero from init” synthesis sentence.
3. `docs/tutorials/README.md`
   - add the POSIX-shell prerequisite;
   - replace the universal “every command was run” authoring claim with the executed-transcript versus
     illustrative-output rule.
4. `docs/README.md`
   - extend the documentation truth rule with the same explicit evidence classes and path-normalizing
     requirement for hand-written output.
5. `AGENTS.md`, `docs/concepts/01-what-this-is.md`, and `packages/netscript-bridge/README.md`
   - remove private identities, links, roles, and features while preserving the ratified repository
     boundary, published contracts consequence, and adapter seam.
6. `.llm/runs/m1-dsh-coordinator--orchestration/reviews/pr-190-glm.md`
   - redact the one historical current-tree reference while preserving the review's verdict and the
     verified public architectural consequence.
7. `.llm/runs/docs-public-boundaries--e10/local-example-receipts.md`, `worklog.md`, and
   `implementation-eval.md`
   - record sanitized verification, progression, and independent final evaluation. Never include the
     private denylist terms, raw operator paths, environment values, auth state, or default-home data.

No other path is in the implementation manifest.

## Dependency DAG

```text
independent Opus 5 review
          |
          v
     Stage G PASS
          |
          v
privacy redaction + Node/POSIX wording
          |
          v
unique-home commands + evidence classification
          |
          v
normalized transcript comparison
          |
          v
links/build + tracked-text privacy scan
          |
          v
independent GLM implementation evaluation
```

## Risk register

| Risk | Likelihood | Impact | Gate |
| --- | --- | --- | --- |
| Historical Node result becomes an accidental support promise | Medium | High | Exact wording review requires “owner testing,” version 22.20.0, issue #212, and “historical; not supported baseline.” |
| Windows evidence implies this POSIX page runs unchanged | Medium | High | Prerequisite and final prose review require POSIX scope and versioned, historical Windows wording. |
| A block appears verified although it depends on live GitHub | Medium | High | Fence census maps every output-like block to executed transcript or source-derived illustration. |
| Temporary state or telemetry overrides contaminate receipts | Medium | High | Unique `mktemp` homes, four `env -u` controls, explicit `--home`, exit-code capture, and cleanup. |
| Path normalization hides a real output difference | Medium | Medium | Allow exactly three documented path substitutions; byte-compare all remaining output. |
| Private identity survives in an unedited current tracked file or new run artifact | Medium | High | Owner-provided denylist scan across all tracked text; durable evidence records only zero/nonzero totals, never terms. |
| Generic redaction erases the published-contract architecture | Low | High | Manual check for the external-consumer/published-contract/no-workspace-import invariant in all four current docs and the historical review. |
| Adjacent edits regress #229, #228, or #230 wording | Low | High | Compare against cited ranges, require the exit-2 synthesis correction, and independently review implementation. |
| Documentation links or Markdown structure break | Low | Medium | `pnpm run check:links`, `pnpm run build`, and `git diff --check`. |
| Verification touches operator state or network | Low | High | Command allowlist, explicit temporary homes, no auth/env reads, and no live forge/GitHub commands. |

## Stage G evaluation gate

Stage G may return `PASS` only if an independent Claude Opus 5 reviewer confirms that:

- every product path is exact and necessary;
- Node 24 remains the declared/recommended baseline without an enforcement claim;
- Node 22.20.0 and Windows appear only as versioned historical owner observations attributed to
  #212;
- every output-like tutorial block has an explicit evidence class;
- local receipts use unique homes, clear all four telemetry overrides, and normalize only the three
  declared path classes;
- the private-name denylist is kept outside tracked artifacts and current tracked text is scanned;
- the #229 guard, #228 exit behavior, and #230 projection wording are protected;
- no product behavior, output-gate script, `BOARD.md`, binary, history rewrite, forge/GitHub mutation,
  default-home read, auth read, or sibling worktree is admitted.

## Implementation acceptance gates

After Stage G passes, implementation is accepted only when all of the following are recorded in the
sanitized local receipts and worklog:

1. A census accounts for every output-like fence in the tutorial as an instruction, executed
   transcript, or source-derived illustration.
2. [`local-example-receipts.md`](local-example-receipts.md) records profile install/dump/check and
   telemetry where/record/runs/why exiting `0` in unique homes at `7f6aed8`; telemetry invocations
   clear the four override variables without reading them. Only the profile excerpt used by the
   tutorial is retained.
3. Normalized output differs from raw output only at the unique profile home, unique telemetry home,
   and checkout path, displayed respectively as `/tmp/dsh-home`, `/tmp/tel-home`, and
   `/path/to/harness`; displayed transcripts match normalized output byte-for-byte.
4. The owner-provided exact private-name denylist finds zero matches in all tracked text. The durable
   report records the result count only.
5. `pnpm run check:links`, `pnpm run build`, and `git diff --check` pass, and `git status --short`
   contains only the exact mutation surface.
6. A diff review confirms the cited #229, #228, and #230 semantics remain unchanged.
7. An independent GLM provider-default implementation evaluation returns `PASS` or all bounded
   required fixes are applied and re-evaluated.
