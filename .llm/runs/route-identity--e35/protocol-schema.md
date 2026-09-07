# Route identity — offline protocol evidence

The installed Codex protocol declares the four observed route fields on the thread-start response. Effort is nullable: null must remain unknown. This is a schema observation, not a live daemon receipt.

## Capture

On 2026-09-07 the coordinator ran `codex app-server generate-ts --out <task-local-schema-directory>` with exit 0. The resolved executable was the installed standalone release `0.153.4-x86_64-unknown-linux-musl/bin/codex`. The command generated TypeScript files locally; it did not attach to a daemon or submit a task. It warned that cleanup of stale arg0 temporary directories encountered permission denial; generation nevertheless emitted the files listed below. No authentication file or live session payload was inspected.

## Selected declarations

These are selected type members transcribed from generated schema, not a complete response fixture or a live response:

    ThreadStartParams: {
      model?: string | null;
      modelProvider?: string | null;
      cwd?: string | null;
      config?: { [key: string]: JsonValue | undefined } | null;
    }
    ThreadStartResponse: {
      thread: Thread;
      model: string;
      modelProvider: string;
      cwd: AbsolutePathBuf;
      reasoningEffort: ReasoningEffort | null;
    }
    TurnStartResponse: { turn: Turn }

Generated schema content hashes (full files, not the selected members above):

- `v2/ThreadStartParams.ts` SHA-256 `3a8e4943c6a9a86de42037096cedb86ac6abef491fb7ca424752663116c24fef`.
- `v2/ThreadStartResponse.ts` SHA-256 `efc3d5df82b8f6f7d320fc97e2c51e8f25dc38195ae49af55f37b2ead8a05464`.
- `v2/TurnStartResponse.ts` SHA-256 `974c520197188b7399836fda0ef1b11e43df618d25295463d2e229e1efa88ffd`.

## External cross-check

The official [app-server documentation](https://learn.chatgpt.com/docs/app-server), retrieved 2026-09-07 through the former `developers.openai.com/codex/app-server` URL, describes response ID correlation, the initialize handshake, and thread creation before starting a turn. Its abbreviated examples omit several route members; the generated schema above establishes their declared types. Neither source proves the runtime configuration of any protected host. That remains an integration gate on [#53](https://github.com/rickylabs/harness/issues/53).
