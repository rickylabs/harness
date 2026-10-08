# Method tools

The method validators and the receipt vocabulary live in `tools/harness/` and `tools/gates/`.
The rules they enforce are in [`docs/DOCTRINE.md`](../docs/DOCTRINE.md); run templates live in
[run-record/templates](../run-record/README.md).

Invocations from the checkout root:

```sh
node method/tools/harness/matrix-receipts.mjs receipt.json
deno task harness:milestone:render -- <run-dir>
deno task harness:milestone:validate -- <run-dir> --github-prs <export.json>
```

The milestone commands need Deno 2 until #658 moves these tools into `packages/method`. The receipt
and blocked-decision tests run under Node as `pnpm run check:receipts` and `pnpm run check:cluster`.

The renderer stamps a historical output provenance header that names its former path. The header is
kept so that completed records still validate byte for byte; that path is not an entrypoint.
