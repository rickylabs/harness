# Context pack — pr-101-fix-re-review--review-claude

## Outcome

**Complete with verdict `FAIL_FIX`.** PR #101 cannot pass re-review at head
[`4d5cc07`](https://github.com/rickylabs/harness/commit/4d5cc071b89d70a8b7895bc78cb669e717c84cf3).

Four requested properties remain open:

1. JavaScript and Go disagree on CR/U+2028/U+2029 in the key regex, so `renderSwarm` can omit its
   guard and Orchid consumes prompt text as a later model override.
2. A terminal pull request whose merge state is unknown is counted as shipped, collapsing it with
   a positively merged pull request.
3. A displaced epic key such as `e6#41` can collide with a real `epic:e6#41` slug, silently dropping
   the displaced issue from the tree.
4. `transportFailure` can throw while reading the `message` of a hostile `Error` subclass.

The default GitHub path is read-only, but the public arbitrary `GhRunner` callback does not satisfy
the issue's stronger no-write boundary. F-4 is closed. F-5 prevents silent truncation, with a
documented false positive when item count equals the limit. Actual CLI processes produced all five
distinct exit statuses. All 29 conformance expectations were independently confirmed against the
pinned Go implementation, but the corpus omits the separator counterexample.

Independent passing controls include deterministic projection/hierarchy, status-prefix boundaries,
conservative multi-phase selection, epic self-counting, progress-bar boundaries, empty and
degenerate inputs, shell-inert repository slugs, leading-dash slug rejection, absence of a forge
dependency, graph validation, 223 package tests, repository typecheck, and repository build.

The full command and result record is in [`adversarial-review.md`](adversarial-review.md).
