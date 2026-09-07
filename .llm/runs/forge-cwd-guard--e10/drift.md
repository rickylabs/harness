# Drift — forge-cwd-guard--e10

## 2026-09-07 — review deltas before implementation

The independent review returned `PASS AFTER NARROW FIXES`. The locked plan remains unchanged; these
bounded deltas are now part of the effective plan, as required by
[`doctrine/WORKFLOW.md:59-69`](../../../doctrine/WORKFLOW.md).

1. Explicit `--repo` is strictly validated as `owner/name`; it is not URL-normalized. This resolves
   comparison ambiguity without changing the documented CLI form. A `.git` suffix is literal in an
   explicit slug because it may be part of the repository name; the origin URL parser strips one
   transport suffix.
2. Origin lookup walks from a nonexistent target cwd to its nearest existing ancestor before invoking
   Git. This strengthens D4: “unknown” means no enclosing GitHub checkout supplies evidence, rather
   than merely “the final path does not exist.” The parent corrected the review's original proposal to
   let nonexistent targets proceed blindly because nested output would otherwise bypass the guard.
3. The strict origin parser carries an explicit valid-form preservation matrix because
   `detectRepoSlug` serves repo inference beyond guarded commands.
4. Forced mismatch is visible on stdout in plain mode and stderr in JSON mode; JSON stdout remains a
   machine-readable document. Dry-run advice preserves `--dry-run`.
5. Mismatch uses a dedicated concise exit-2 error and recommends read-only `doctor` inspection.
6. Invalid skill subcommands are excluded from the writer predicate.
7. Disposable Git fixtures isolate global/system configuration without overriding `HOME` or touching
   auth state.
8. The parent coordinator, not this implementation session, owns the post-guard #209/#212 GitHub
   actions and closure-artifact formatting.

These changes retain the original safety intent and mutation surface. No rescope or owner fork is
introduced.
