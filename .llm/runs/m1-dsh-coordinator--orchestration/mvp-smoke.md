# Runnable board and telemetry preview

This is a CLI preview, not a claim that E6/E9 acceptance passed. Reviewed source baseline: `66af5123411eda8a9598e3f1bcfcff6a28c8b358`. Board and telemetry packages are private workspace packages (`packages/board/package.json:6`, `packages/telemetry/package.json:6`); use the checkout, not an invented npm release.

Prerequisites: Node 24+, pnpm 11.25.0 (`package.json:8`), authenticated GitHub CLI with permission on the target repository. Commands below use Bash. Set TARGET and TARGET_DIR to a fresh disposable repository you own; installing changes its label taxonomy and writes generated files. Choose an ordinary test issue with no dispatch label. Do not apply `harness`.

    git clone https://github.com/rickylabs/harness.git harness-preview
    cd harness-preview
    git checkout 66af5123411eda8a9598e3f1bcfcff6a28c8b358
    pnpm install --frozen-lockfile
    pnpm run build
    HARNESS_DIR="$PWD"
    TARGET=owner/test-repository
    TARGET_DIR=/absolute/path/to/test-repository
    node "$HARNESS_DIR/packages/forge/dist/cli.js" init --repo "$TARGET" --cwd "$TARGET_DIR" --no-detect
    gh label create topic:internals --repo "$TARGET" --color 5319e7 --description "Internal work lane"
    ITEM=$(gh issue create --repo "$TARGET" --title 'Board preview' --body 'Manual board projection smoke test; no agent dispatch.' --label type:chore --label status:triage --label topic:internals)
    ITEM_NUMBER="${ITEM##*/}"
    node "$HARNESS_DIR/packages/board/dist/cli.js" columns --repo "$TARGET" --lane-prefix topic
    gh issue edit "$ITEM_NUMBER" --repo "$TARGET" --remove-label status:triage --add-label status:research
    node "$HARNESS_DIR/packages/board/dist/cli.js" check --repo "$TARGET" --lane-prefix topic
    node "$HARNESS_DIR/packages/board/dist/cli.js" columns --repo "$TARGET" --lane-prefix topic

The item moves from triage to research on the next read. No model is called. The installed taxonomy is real; this sequence does not provision a dispatcher. CLI implementation: `packages/forge/src/cli.ts:135`, `packages/board/src/cli.ts:65`.

Read that same board through telemetry, with explicitly synthetic run events in an isolated temporary store:

    DEMO_DIR=$(mktemp -d)
    export DSH_TELEMETRY_DIR="$DEMO_DIR/observability"
    export DSH_TELEMETRY_ARCHIVE=none
    node "$HARNESS_DIR/packages/board/dist/cli.js" snapshot --repo "$TARGET" --lane-prefix topic > "$DEMO_DIR/board.json"
    printf '{"runId":"preview-fixture","kind":"smoke","detail":{"source":"codex","branch":"issue-%s","outcome":"running"}}\n' "$ITEM_NUMBER" | node "$HARNESS_DIR/packages/telemetry/dist/cli.js" record --home "$DEMO_DIR"
    node "$HARNESS_DIR/packages/telemetry/dist/cli.js" tree --home "$DEMO_DIR" --items "$DEMO_DIR/board.json"
    printf '{"runId":"preview-fixture","kind":"smoke","detail":{"source":"codex","branch":"issue-%s","outcome":"complete"}}\n' "$ITEM_NUMBER" | node "$HARNESS_DIR/packages/telemetry/dist/cli.js" record --home "$DEMO_DIR"
    node "$HARNESS_DIR/packages/telemetry/dist/cli.js" tree --home "$DEMO_DIR" --items "$DEMO_DIR/board.json"
    unset DSH_TELEMETRY_DIR DSH_TELEMETRY_ARCHIVE

Expected: one synthetic run under the issue changes from running to complete. Empty vendor stores and absent quota are honest absence, not zero capacity. The board phase stays research: run completion does not authoritatively change GitHub. Change a phase in GitHub and regenerate the snapshot to see another board update. CLI reads the supplied snapshot, not a hidden live board (`packages/telemetry/src/cli.ts:486`); live events merge by run ID (`packages/telemetry/src/live.ts:354`), issue attribution uses the branch (`packages/telemetry/src/model.ts:288`).

Validation on the baseline: fetched the live harness board and joined an isolated synthetic run to issue 203. Both running and complete tree reads exited 0; no vendor transcript or real home telemetry was read. The first trial used invalid outcome `completed`; the model accepts `complete`, so the corrected sequence above was re-run. The installation command is documented from the CLI; it was not applied to an unrelated repository during this run. The real board mutation tested was issue 203 moving from triage into E6 research, then appearing in a fresh snapshot. A fresh-repository installation remains an owner-run smoke step, not a claimed observation.

Owner forks and missing implementation are recorded in `plan.md` and the evaluation receipts. This preview does not demonstrate dsh session-projection/todo integration, live local headroom, admission decisions, production storage, push delivery, or a real model canary.
