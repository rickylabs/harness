# durable-state--e6a — supervisor

Issue [245](https://github.com/rickylabs/harness/issues/245), local store only. Coordinator Astra medium on Codex; baseline `65aaca8f4361658078e328afbf1688ace4d635e4`. Host identity deliberately omitted from public evidence.

Authorized mutation surface: packages/contracts/src/state-store.ts and index.ts; packages/coordinator/src/journal.ts, record.ts (stale dependency comment only), state-store*.ts, index.ts and tests/fixtures for this store; coordinator package.json and tsconfig.json if needed for the published contract dependency; pnpm-lock.yaml only for that dependency; contracts/coordinator READMEs, packages/README.md and root README.md if behavior claims need correction; this run directory. No transport server, provider, dsh-app runtime, production wiring, workflow files, generated BOARD, or protected owner issues.

Only planning artifacts before independent Stage G PASS. One PR against main; owner reviews and merges.
