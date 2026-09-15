import { openCodexThreadReader, codexThreadEvidence } from "../../../packages/telemetry/dist/codex-threads.js";
const reader = await openCodexThreadReader({ limit: 500, timeoutMs: 30000, includeSensitive: true });
try {
  const snapshot = await reader.read();
  const refused = snapshot.rows.filter(r => r.tokenBudget.reason === "thread_not_found");
  const verified = !snapshot.complete && snapshot.reason === "thread_not_found" && refused.length > 0 &&
    refused.every(r => ["goalObjective", "goalStatus", "tokenBudget", "tokensUsed", "secondsUsed"].every(k => r[k].value === null && r[k].reason === "thread_not_found"));
  console.log(JSON.stringify({ verdict: verified ? "PASS" : "INCONCLUSIVE", claim: "daemon refusals preserved as unavailable rows with their reason", evidence: codexThreadEvidence(snapshot) }));
  if (!verified) process.exitCode = 3;
} finally { reader.close(); }
