# AI regression recipe

From a fresh NetScript main worktree: `deno run --allow-read --allow-write --allow-run .llm/tools/run-deno-test.ts -- --allow-all packages/ai/tests plugins/ai`. Target one regression file during loops. Structured output records process/type errors separately from assertion failures; a type failure is not reproduction. Local Deno is 2.9.7; CI pins 2.9.5, needed for deterministic generated docs.
