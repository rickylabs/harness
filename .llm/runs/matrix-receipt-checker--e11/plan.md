# Locked I1 implementation plan

Implement only the receipt checker and CI stage. Scope: `.llm/tools/harness/matrix-receipts.mjs`,
its Node test file, root `package.json`, `profiles/README.md`, `docs/reference/matrix-receipts.md`,
and this evidence directory. No dispatcher, routing policy, cluster validator, charter or mailbox
runtime changes. The user assigned charter section 11 items 1–2 and section 7 enforcement.

Design and nine incorporated fixes: [receipt contract](https://github.com/rickylabs/harness/blob/fe057a1/.llm/runs/charter-enforcement--e11/receipt-contract.md).
Independent [review](https://github.com/rickylabs/harness/issues/341#issuecomment-5660838420) and
[admissibility reassessment](https://github.com/rickylabs/harness/issues/341#issuecomment-5660892015)
permit this bounded slice after those fixes. Use the already-declared js-yaml reader to reject
duplicate keys after JSON.parse rejects non-JSON input. Do not hand-roll a tokenizer.

Gates: targeted Node CLI/validator tests including deliberate bad receipts and a wiring control;
root pnpm typecheck/build/test; independent implementation evaluation at the fresh feature row.
Missing observation is unproven, never green. No fleet policy is compiled into this tool.
Risk: parser semantic differences, false receipt pass, output leakage and unreachable root stage;
tests cover each. Dependency: plan PASS → implementation → gates → independent source review.
Owner forks: none for this implementation. Dual-agent promotion belongs to the separate draft.
