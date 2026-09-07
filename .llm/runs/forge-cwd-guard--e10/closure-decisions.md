# Steer 5 closure decisions

#209 is complete; #212 remains open for a missing executable prose-output gate.
These decisions are authorized explicitly by steer 5 and follow the guard work in its sequence.

## 209 — complete

PR #223 merged 033da731f37fa66d9d6c4a0342d97d5c7986ffb4; PR #228 merged
99d48dec3e04aed3c17aa7aa83a6867be225bfbe. Retrieved in this run:
https://github.com/rickylabs/harness/pull/223 and
https://github.com/rickylabs/harness/pull/228.
Together they deliver the new human/agent-first README, architecture and audience paths,
code-backed maturity distinctions, rewritten concepts and safe tutorial paths. The existing
public-docs-relaunch--e10 run contains research, independent plan/content/presentation reviews,
command receipts and review dispositions. Owner PR #228 corrects the refused-label clause the
content reviewers missed: refusal propagates exit 1; unavailable/skipped apply can return 0.
That correction is authoritative over the historical PASS receipts.

No further docs merge is needed. PR #227 was closed by the owner as superseded; its worktree
was removed on steer 5. Screenshot binaries must not be re-added. The host-local refreshed
375px presentation review passed at 1f164ce; this is presentation evidence only, not an exact-head
content approval for 99d48de. Owner verified and merged the final wording in PR #228.
The proposed website choice in #148 and future output gate in #212 are separate work, not relaunch
acceptance. Close #209 naming both delivered commits after the guard work.

## 212 — remain open

The concrete stale tutorial blocks were corrected in #223, and #226 corrected another telemetry
example (c98fbeb90541bb20eeec3acc5810dde0973237c5):
https://github.com/rickylabs/harness/pull/226.
However package.json:18-24 still routes check:docs only through scripts/cli-reference.mjs;
that script:29 confines generation/comparison to docs/reference/cli. Neither that gate nor
check:links executes and compares pasted authored-prose examples.
docs/concepts/05-determinism.md:93-100 explicitly admits that gap and links #212.
Correct examples plus an admission do not implement the requested gate.

Keep #212 open, preserving p2 / E10 / M1, and comment that the instance fixes shipped but acceptance
still needs bounded, deterministic example execution in disposable fixtures, compared with
marked prose blocks. Network-writing tutorial steps should stay explicitly outside that gate
unless an isolated transport makes them safe. This turn judges closure; it does not implement
that separate gate.

## Execution ownership

The parent coordinator performs these GitHub closures/comments after the guard work. The Sol implementation session only authors local artifacts and product code; it does not mutate GitHub.
