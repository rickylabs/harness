/** Deno service entry. Static aliases are resolved by the CLI's in-memory import map.
 * This file is deliberately outside src/ and the Node TypeScript project.
 */
import { fetchOpenCodeGoUsageSnapshot } from "harness:usage";
import { EXPENSE_SNAPSHOT_MAX_AGE_MS } from "harness:usage-validity";

const [model, credentialEnv, bytesArg, timeoutArg] = Deno.args;
try {
  if (!model || !credentialEnv || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialEnv)) throw new Error();
  const maxBytes = Number(bytesArg);
  const timeoutMs = Number(timeoutArg);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4_194_304 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error();
  const credential = Deno.env.get(credentialEnv)?.trim();
  if (!credential) throw new Error();
  const denied = async (): Promise<never> => { throw new Error("file access denied"); };
  const snapshot = await fetchOpenCodeGoUsageSnapshot(model, {
    env: { OPENCODE_API_KEY: credential },
    readTextFile: denied,
    stat: denied,
    now: () => new Date().toISOString(),
    fetch: async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (String(url) !== "https://opencode.ai/zen/go/v1/usage") throw new Error();
      const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok || response.body === null) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  if (!Number.isSafeInteger(EXPENSE_SNAPSHOT_MAX_AGE_MS) || EXPENSE_SNAPSHOT_MAX_AGE_MS < 1) throw new Error();
  // Validate and copy each field before stdout, not merely after the parent receives it.
  // The vendor usage source emits these two statuses; unexpected prose is unread evidence.
  const timestamp = (value: unknown): value is string => typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
    Number.isFinite(Date.parse(value));
  if (snapshot.provider !== "opencode_go" || !timestamp(snapshot.capturedAt)) throw new Error();
  const percentageWindows = Object.fromEntries(
    (["rolling_five_hours", "weekly", "monthly"] as const).map(id => {
      const row = snapshot.percentageWindows?.[id];
      if (!row || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100 ||
          (row.status !== "ok" && row.status !== "rate-limited") ||
          (row.resetsAt !== undefined && !timestamp(row.resetsAt))) throw new Error();
      return [id, { percent: row.percent, status: row.status,
        ...(row.resetsAt === undefined ? {} : { resetsAt: row.resetsAt }) }];
    }),
  );
  console.log(JSON.stringify({ provider: "opencode_go", capturedAt: snapshot.capturedAt,
    percentageWindows, validForMs: EXPENSE_SNAPSHOT_MAX_AGE_MS }));
} catch { Deno.exitCode = 3; }
