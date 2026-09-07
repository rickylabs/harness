# PR 190 implementation evaluation

Evaluator: GLM 5.3 Flash, OpenCode Go, provider-default.
Matrix: netscript 8ba53bc50ca02aab29e99ba5362728839b8f1713, straightforward IMPL-EVAL.
Author family: Anthropic; evaluator family: Zhipu.
Head: faebcda72b2418456e9365825020f459356b3b28.
This is a verdict and verification report, not a reasoning-trace claim.

FAIL_FIX

**Head evaluated:** `faebcda72b2418456e9365825020f459356b3b28` (worktree clean, matches `git rev-parse HEAD`; diff `origin/main...HEAD` = 10 files, +97/−47, docs-only).

**Failing criterion — declared-scope completeness.** The PR advertises "correct every claim the repository going public made false" (title) against #189's In-scope list, which explicitly includes `CONTRIBUTING.md` and `packages/*/README.md`. Two false private-visibility claims — exactly the claim class this PR exists to fix — survive inside that scope:

1. `CONTRIBUTING.md:180-184` — "this is a private repository with a single owner… If the repository is ever opened up, that changes and this section changes with it." The repository **is** public (verified: `gh api repos/rickylabs/harness` → `visibility: public`); the file's own trigger has fired and the section did not change.
2. `packages/provider-claude/README.md:113` — "CI runs `pnpm install --frozen-lockfile` on every job… on a private repository whose minutes are billed." Repo is public; also the basis of a cost argument in the same paragraph.

Bounded fix: two files, ~4 lines. Per `doctrine/WORKFLOW.md:117` this is "the plan is sound; specific parts are wrong."

**Verified true (rest of the diff holds):**
- External consumer relocation (AGENTS.md:101-108, README.md:268-278, docs/concepts/01-what-this-is.md:29-35, packages/netscript-bridge/README.md:26-28) matches the #30 amendment verbatim in substance (external consumers separated into their own repositories, "contracts still has to be a published package" = "the half the amendment left standing").
- Census: measured 11 shipping packages / 4 stubs (12-line placeholders: governance, netscript-bridge, provider-codex, provider-acp); stub READMEs carry `Status: stub` with owner+blocker.
- Decision count stays four: #30 *Decisions taken* table rows 5–6 are marked *(taken here, reversible)*; README.md:279-281 reversion is correct.
- `NPM_TOKEN` secret exists (name-only, `gh secret list`: created 2026-09-06T19:33:24Z); no `harness-contracts-v*` tag exists (`git ls-remote --tags`); `release-contracts.yml:23-30` `workflow_dispatch` `dryRun` default `true` — GOVERNANCE.md:75-77 and packages/contracts/README.md:254-256 accurate.
- Security: private vulnerability reporting `{"enabled":true}`, secret scanning + push protection enabled; `has_discussions`/`has_wiki` false — SECURITY.md:14, SUPPORT.md claims correct.
- Repo description matches `package.json:5` exactly; ran `node scripts/check-metadata.mjs` read-only → exit 0.
- `build` runs exactly the 8 checks claimed (package.json:23); `check:metadata` deliberately outside it; check-script headers match the "refuses to let through" table; CI on head: check run `typecheck · build · test` → success.

**Notes (non-gating):** `.github/workflows/ci.yml:20` ("This repository is private") and `release-contracts.yml:3-4` ("cockpits live in netscript… Everything else is private") carry the same stale claims but workflows were not in #189's In list; README.md:330's "each script's header comment names the specific incident" is loose for `check:links`/`check:docs` (failure-mode prose, no incident); the PR body's line counts inherited from #189 (1247/1131/1848) don't match a straight count (2129/2544/3981) — no repository file carries them.
