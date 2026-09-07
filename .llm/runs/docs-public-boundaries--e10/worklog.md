# Worklog — docs-public-boundaries--e10

## Execution metadata

- **Role**: Documentation Author
- **Model**: Gemini 3.8 Flash, high (`gemini-3.8-flash`)
- **Working baseline**: `7f6aed8`
- **State**: Bounded polish complete; parent literal proof reported; remaining verification PENDING parent coordinator

## Summary of mutations

All changes strictly adhere to the exact implementation manifest from `plan.md`, binding dispositions in `drift.md`, and polish guidance:

1. `AGENTS.md`
   - Redacted private consumer identities, role descriptions, and repositories from ratified decision 4, adopting the direct phrasing "Private external consumers live in separate repositories".
   - Dropped the specific historical decision issue-comment URL, pointing to generic `#30` while preserving the ratified repository boundary and published contract package invariant (`@rickylabs/harness-contracts`, no workspace imports).

2. `README.md`
   - Formulated Node 24 as the declared and recommended baseline without implying that default pnpm enforces it.
   - Simplified repetitive phrasing to "Private external consumers live in separate repositories (such as a cockpit and a mobile client we run against it)".
   - Dropped the specific historical decision issue-comment URL, pointing to generic `#30`.
   - Redacted all private external consumer identities, repository references, and framework/role terms in architecture overview, ratified decision 4, and package listings.
   - Preserved all #230 projection anomaly/detail/fetch-coverage language, #229 guard mentions, #228 exit semantics, and existing #212 admissions regarding prose output.

3. `docs/concepts/01-what-this-is.md`
   - Redacted private consumer names and roles in "It is not a UI", stating "Private external consumers — such as a cockpit and a mobile client we run against it — live in separate repositories".
   - Dropped the specific historical decision issue-comment URL, pointing to generic `#30`.
   - Preserved the published contract package requirement (`@rickylabs/harness-contracts`), npm-only consumption, and ratified decision 4 boundary.

4. `packages/netscript-bridge/README.md`
   - Redacted private consumer product names in the inbound relationship description and references.
   - Preserved the runtime adapter seam, published contract boundary, and no-workspace-import invariant.

5. `.llm/runs/m1-dsh-coordinator--orchestration/reviews/pr-190-glm.md`
   - Redacted the historical review's current-tree reference to private consumer product names and repo-resolution claim.
   - Dropped the specific historical issue-comment ID in favor of "matches the #30 amendment verbatim in substance".
   - Preserved the review verdict (`FAIL_FIX`), verification notes, and verified published contract package boundary.

6. `docs/tutorials/README.md`
   - Added POSIX shell to the tutorial prerequisites table.
   - Replaced the universal "every command must be run" claim with the honest distinction between command instructions, executed transcripts, and illustrative outputs.

7. `docs/README.md`
   - Extended the documentation truth rule to require explicit evidence classes (executed transcripts vs illustrative outputs) and path normalization for hand-written output examples.

8. `docs/tutorials/01-from-clone-to-board.md`
   - Added POSIX shell prerequisite and platform boundary note, documenting the versioned Windows observation recorded on #212 at `4ff50fe` under Node 22.20.0 as historical coverage (build/tests, offline profile/telemetry path, read-only `doctor`) rather than general platform support.
   - Clarified that Node 24 is the declared and recommended baseline and that default pnpm install warns rather than fails on older releases (noting #212 historical run).
   - Replaced fixed home paths in steps 4 and 5 with unique temporary homes created via `mktemp -d` (`$PROFILE_HOME`, `$TELEMETRY_HOME`), passed explicitly to `--home`, and cleared all four `DSH_TELEMETRY_*` environment override variables via `env -u` on every telemetry invocation.
   - Retained the full runtime and normalization note once directly before Step 4 output.
   - Used concise output labels thereafter referencing that note: `*(Executed transcript — normalized; see note above)*` and `*(Executed excerpt — normalized, base bundle omitted; see note above)*`.
   - Classified all prose expectations strictly into either executed expectations referencing the runtime note (`check`, `where`, `runs`) or source-derived illustrative expectations (Step 1 tests, Step 2 file status & check, Step 3 columns, Step 5 failure prose).
   - Preserved command blocks unchanged per literal execution verification.
   - Preserved the #229 `--repo`/`--cwd` mismatch guard and #228 exit semantics, and repaired the stale later synthesis sentence in step 2 to note that exit `2` covers mismatch/malformed argv while exit `1` covers label refusal/conflict.
   - Added note on read-only `doctor` behavior while citing #215 as out of scope.

## Tutorial Output & Prose Census (`01-from-clone-to-board.md`)

| Location | Form | Text / Command | Evidence Class | Notes |
| --- | --- | --- | --- | --- |
| Step 1 | Code fence | `git clone ... cd harness ... pnpm install ... pnpm run build` | Instruction | Build instructions |
| Step 1 | Code fence | `pnpm test` | Instruction | Test execution instruction |
| Step 1 | Prose | `packages/dsh-app test: … pass …` | Illustrative expectation | Source-derived inline description of test runner output |
| Step 2 | Code fence | `node packages/forge/dist/cli.js doctor ...` | Instruction | Target repository inspection |
| Step 2 | Code fence | `node packages/forge/dist/cli.js init ... --dry-run` | Instruction | Dry-run change preview |
| Step 2 | Code fence | `node packages/forge/dist/cli.js init ...` | Instruction | Label and skill install |
| Step 2 | Code fence | `git -C ../scratch status --short` | Instruction | Local filesystem status |
| Step 2 | Prose | `.github/` and `.claude/` as new | Illustrative expectation | Source-derived description of local uncommitted files |
| Step 2 | Code fence | `gh label list --repo owner/scratch --limit 100` | Instruction | Raw GitHub readback (unexecuted by author) |
| Step 2 | Code fence | `node packages/forge/dist/cli.js labels check ...` | Instruction | Strict drift check |
| Step 2 | Prose | `nothing to do — the repository already carries this taxonomy` | Illustrative expectation | Source-derived description of matching taxonomy check |
| Step 3 | Code fence | `gh issue create ...` | Instruction | Issue creation |
| Step 3 | Code fence | `node packages/board/dist/cli.js columns ...` | Instruction | Initial board projection |
| Step 3 | Prose | `## triage` | Illustrative expectation | Source-derived description of initial issue placement |
| Step 3 | Code fence | `gh issue edit ...` | Instruction | Status transition |
| Step 3 | Code fence | `node packages/board/dist/cli.js columns ...` | Instruction | Updated board projection |
| Step 3 | Prose | `## impl` | Illustrative expectation | Source-derived description of updated issue placement |
| Step 3 | Code fence | `node packages/board/dist/cli.js check ...` | Instruction | Board consistency check |
| Step 3 | Code fence | `no anomalies — every item has exactly one status label` | Illustrative output | Source-derived; unexecuted against live GitHub |
| Step 3 | Code fence | `## closed-but-unshipped ... ## no-status ...` | Illustrative output | Source-derived; unexecuted anomaly examples |
| Step 4 | Code fence | `PROFILE_HOME=$(mktemp -d); node packages/dsh-app/dist/cli.js install --home "$PROFILE_HOME"` | Instruction | Profile installation in unique temporary home |
| Step 4 | Code fence | `profile   rickylabs ...` | Executed transcript | Tested at `7f6aed8` on Linux/Node 26.8.1; normalized placeholders |
| Step 4 | Code fence | `DSH_HOME="$PROFILE_HOME" packages/dsh-app/node_modules/.bin/dsh --profile rickylabs --dump-config` | Instruction | Dump configuration invocation |
| Step 4 | Code fence | `# == @rickylabs/dsh-app ...` | Executed transcript | Tested at `7f6aed8` on Linux/Node 26.8.1; marked excerpt (base bundle omitted) |
| Step 4 | Code fence | `node packages/dsh-app/dist/cli.js check --home "$PROFILE_HOME"` | Instruction | Profile verification |
| Step 4 | Prose | `installed and matching.` | Executed expectation | Preceded by profile configuration summary; normalized |
| Step 5 | Code fence | `TELEMETRY_HOME=$(mktemp -d); env -u ... node packages/telemetry/dist/cli.js where --home "$TELEMETRY_HOME"` | Instruction | Query telemetry store paths |
| Step 5 | Prose | Description of `where` live/archive/grep targets | Executed expectation | Verified in receipts; preserved as prose description |
| Step 5 | Code fence | `printf ... \| env -u ... node packages/telemetry/dist/cli.js record --home "$TELEMETRY_HOME"` | Instruction | Telemetry event recording |
| Step 5 | Code fence | `recorded 2 event(s) to /tmp/tel-home/observability/dsh-telemetry.jsonl` | Executed transcript | Tested at `7f6aed8` on Linux/Node 26.8.1; normalized placeholder |
| Step 5 | Code fence | `env -u ... node packages/telemetry/dist/cli.js runs --home "$TELEMETRY_HOME"` | Instruction | Telemetry runs listing |
| Step 5 | Prose | Columns summary (`2026-09-05T10:04:00Z  claude    complete claude-opus-5`) | Executed expectation | Normalized; preserved as prose description |
| Step 5 | Code fence | `env -u ... node packages/telemetry/dist/cli.js why demo-1 --home "$TELEMETRY_HOME"` | Instruction | Triage lookup |
| Step 5 | Code fence | `demo-1 (claude, complete) — look here, in this order: ...` | Executed transcript | Tested at `7f6aed8` on Linux/Node 26.8.1; normalized placeholder; terminal blank lines omitted |
| Step 5 | Code fence | `rm -rf "$PROFILE_HOME" "$TELEMETRY_HOME"` | Instruction | Safe cleanup of created temporary homes |
| Step 5 | Code fence | `claude: no store on this box ...` | Illustrative output | Source-derived; unexecuted failure cases |
| Step 5 | Prose | Failure reasons (`claude: no store`, missing source) | Illustrative explanation | Source-derived illustrative explanation |

## Verification status

- **Parent literal proof**: The parent coordinator reported literal execution of all 8 Step 4/5 bash blocks: exited `0`, all 4 retained output fences matched under declared normalization, and both fresh temporary homes were cleanly removed. (Executed by parent coordinator, not by author).
- **Remaining verification pending parent coordinator**:
  - Link checks (`pnpm run check:links`).
  - Full repository build and consistency checks (`pnpm run build`).
  - Git diff format check (`git diff --check`).
  - Tracked-text privacy scan against the owner-provided private denylist.
  - Independent GLM implementation evaluation.

## Coordinator verification

Issue231 tracks this addendum correction;212 remains open for its automated gate. Final literal-command proof passed: eight blocks, four normalized transcript matches, fresh homes cleaned; see local-example-receipts.md. Current tracked and proposed-text privacy scan returned zero identifier matches across 488 files. Repository build exited0; final link/diff checks and independent GLM review follow. No real forge write, auth/default-home read, binary, BOARD edit, or history rewrite. GLM transport uses the same logical model through opencode after the preferred opencode-go route previously timed out with zero response in this coordinator session; that observed fallback is retained rather than substituting a model.

## Implementation review repair

Independent GLM source review at6044541 returned FAIL_FIX for a duplicated telemetry explanation. Gemini removed only the second unlabeled copy (six lines); the labeled explanation remains. No command block changed, verified against the SHA256 in local-example-receipts.md, so the executed-example proof still applies. All other reviewed content/evidence/privacy checks were clean. See implementation-eval-1.md; the same independent session re-evaluates this correction.
