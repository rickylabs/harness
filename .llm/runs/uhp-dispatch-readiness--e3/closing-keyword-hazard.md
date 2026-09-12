# A warning against closing an issue closed the issue

Self-inflicted, on 2026-09-12, by this run. Recorded in full because it is the sharpest instance of
the class this run spent the day cataloguing, and because the run produced it while writing about it.

## What happened

PR #291 was squash-merged at `2026-09-12T00:45:54Z`. Issue #53 closed at `2026-09-12T00:45:57Z`,
three seconds later, with reason `COMPLETED` and no actor recorded on the timeline event.

#53 is E3.3, `provider-codex` against the running app-server daemon. It closes **only** after Spike
S11 (#289) proves multi-turn continuation on a real HarnessRouter Codex harness. S11 has not run and
cannot run yet, because neither coordinator sandbox has a container runtime. So the closure retired a
working in-tree path on no evidence at all.

## The cause

The squash commit body, at line 114, carries this sentence:

    round-trip is not, and a PASS derived from a fixture must not close #53. Both

GitHub's closing-keyword parser reads commit messages and pull request bodies for
`close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved` followed by an issue reference. It
matched `close #53` inside that sentence. **It does not read negation.**

So the sentence written specifically to prevent #53 from being closed on mock evidence is the thing
that closed it on no evidence.

## Response

- #53 reopened immediately, with the cause and the unchanged S11 precondition recorded on the issue.
  `status:triage` unchanged. No supersession occurred.
- Checked for other casualties: no other issue closed in that window. #53 was the only one.
- The phrase in `milestone-status.md` rewritten as "must not close issue 53", dropping the `#`.
  `closing` is not in the keyword list, but dropping the reference marker is the form that cannot
  misfire regardless of how the parser changes.

## Why this belongs in the board rules rather than only in this run

`AGENTS.md` already warns that a dispatched issue body must contain no fenced code blocks, because a
parser that stops at a fence runs a truncated brief and reports nothing. **This is the same family:
a parser reading prose for a control instruction, with no way for the author to mark a mention as
not-an-instruction, and a silent effect when it guesses wrong.**

The existing rule in the board-process skill says `Closes #<n>` is not optional and to aim it at the
sub-issue rather than the umbrella, because a keyword pointing at an epic closes it over its open
children. That rule assumes the author wrote the keyword on purpose. The failure here is the inverse
and is not covered: **a keyword the author wrote in order to forbid the action.**

Proposed addition, filed as its own issue rather than edited into the generated skill:

> Never write a closing keyword next to an issue reference unless you mean it, **including inside a
> negation or a quotation.** `must not close #53`, `do not fix #12`, `this does not resolve #7` all
> close those issues. Write the number without `#`, or use a non-keyword verb: "must not be treated
> as closing #53" is safe, "must not close #53" is not.

## Where it sits in the catalogue

Every other instance this run recorded was a system reporting absence as normality, or absence
wearing a misleading signal. This one is worse in a third way: **the operator's own words were
executed as a command.** Nothing was silent and nothing was misleading. The prose was correct, the
intent was correct, and the mechanism read it as the opposite instruction and acted on it within
three seconds.

It also failed every guard this run had been strengthening all day, because none of them look at
commit prose:

- CI was green, and correctly so; nothing was wrong with the code.
- `dsh-board check` caught it, and is the only reason it was noticed — it reported
  `closed-but-unshipped: #53 closed on GitHub but sits in triage`. That guard is the counter-example
  again: it compared two facts that should agree, found they did not, and said so.
- The run's own discipline about not treating a mock as proof was intact throughout. The discipline
  was not what failed.

`dsh-board check` earning its keep is the one good thing here. Without it, #53 would have read as a
completed supersession on a board where three coordinators take that at face value.

[observed — PR #291 mergedAt 2026-09-12T00:45:54Z, #53 closedAt 2026-09-12T00:45:57Z with
 stateReason COMPLETED and a null timeline actor, squash commit 86b48a3 body line 114, and
 `dsh-board check` reporting the resulting anomaly; verified 2026-09-12]
