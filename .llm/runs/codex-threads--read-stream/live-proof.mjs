import { openCodexThreadReader, codexThreadEvidence } from "../../../packages/telemetry/dist/codex-threads.js";
const reader = await openCodexThreadReader({ limit: 500, timeoutMs: 30000, includeSensitive: true });
try {
  const snapshot = await reader.read();
  if (!snapshot.rows.length) { console.log(JSON.stringify({ verdict: "INCONCLUSIVE", reason: snapshot.reason ?? "empty_source" })); process.exitCode = 3; }
  else {
    console.log(JSON.stringify({ command: "read native thread snapshot", verdict: snapshot.complete ? "PASS" : "INCONCLUSIVE", evidence: codexThreadEvidence(snapshot) }));
    if (!snapshot.complete) process.exitCode = 3;
    const events = reader.events(); let timer;
    const next = await Promise.race([events.next(), new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]);
    clearTimeout(timer);
    if (!next || next.done || next.value.type === "unavailable") process.exitCode = 3;
    console.log(JSON.stringify(next && !next.done && next.value.type !== "unavailable"
      ? { command: "subscribe to native goal notifications", verdict: "PASS", eventType: next.value.type, valuesWithheld: true }
      : { command: "subscribe to native goal notifications", verdict: "INCONCLUSIVE", reason: next?.value?.reason ?? "no_goal_notification_observed", observationSeconds: 5 }));
  }
} finally { reader.close(); }
