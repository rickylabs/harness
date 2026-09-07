# Adversarial review — forge-cwd-guard--e10

## Verdict

**PASS AFTER NARROW FIXES.** Claude Opus 5, medium, independently reviewed the locked plan in
session `54237177-9f5a-4058-b6d2-01d8ba305bb3`. It found the identity-keyed design, pre-context
ordering, three-command writer scope, and absent-origin compatibility sound. Six findings block
implementation until bounded dispositions are recorded; five lower-severity findings must land with
implementation. No finding changes the approach.

The review was returned from exact artifacts at baseline
`946dcfcadf8a25cc29425f65b5fa429951830459`. Its source receipt is
`/home/agent/projects/harness/.git/seat3-forge217-plan-review.json` on the review host; this durable
artifact records all findings and dispositions below.

## Required findings

### F1 — Normalize or validate explicit `--repo`

The plan specifies origin parsing but not the input grammar for `values.repo`, leaving equivalent or
malformed inputs ambiguous. The reviewer requires one symmetric policy: parse both as URLs/slugs, or
strictly accept only the documented `owner/name` slug.

### F2 — Make enclosing-repository behavior explicit

Running Git from a nested target finds an enclosing checkout, which is the desired protection but was
incidental. The review requested nested-directory and nonexistent-cwd controls. The parent refined
this finding: a nonexistent nested target must walk to its nearest existing ancestor, or it can bypass
the guard while still writing into the mismatching checkout.

### F3 — Bound strict-parser effects on repo inference

Tightening `detectRepoSlug` affects every repo-inferred command. Preserve valid HTTPS, credentialed
HTTPS, SSH URL, Git URL, scp-like SSH, port, optional `.git`, and trailing-newline forms while rejecting
lookalike hosts and malformed paths.

### F4 — Make forced mismatch visible

Because `--force` is already common for label conflicts, bypassing the new guard silently could repeat
the defect. Both normalized identities must appear in a warning; matching inputs must print no warning.
Machine-readable `--json` stdout must remain valid.

### F5 — Isolate real-Git fixtures from ambient config

Fixture Git commands must set test-scoped `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to nonexistent
paths and use `git init -q`, so global URL rewrites and policy cannot affect results. Tests may set only
these Git configuration variables; they must not override `HOME` or inspect/change authentication.

### F6 — Resolve closure/GitHub-mutation sequencing

The implementation manifest forbids GitHub mutation while `closure-decisions.md` describes later issue
actions. The implementation session must not choose between them: the parent coordinator alone owns
the post-guard #209/#212 comments and closure.

## Lower-severity findings

### F7 — Avoid an eighty-line usage preamble for a mismatch

The existing `UsageError` handler prints full help before its message. Either describe that output
honestly or use a dedicated concise exit-2 error path.

### F8 — Point refusal at `doctor`

The mismatch diagnostic should name the read-only command that lets an operator inspect resolution.

### F9 — Preserve preview intent in the remedy

A mismatch under `--dry-run` must recommend `--force --dry-run`, not plain `--force`.

### F10 — Validate unknown skill subcommands first

`skill garbage` should report an unknown subcommand instead of being preempted by the checkout guard.
The writer predicate should include only `skill` and `skill install`.

### F11 — Repair closure cross-reference formatting

The closure artifact omitted spaces and `#` markers in several issue/PR references. The parent
coordinator owns that artifact and will repair it before using any text externally.

## Checks that passed

The reviewer confirmed that the guard can execute before `resolveContext`; the selected writer set is
complete; apply is correctly excluded; absent and non-GitHub origins preserve offline behavior; raw
origin URLs need never be emitted; fake transport plus local disposable Git fixtures stay within the
authorization; and generated reference plus tutorial updates are the right documentation gates.

