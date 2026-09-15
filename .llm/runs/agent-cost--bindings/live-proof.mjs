/** Read-only live component proof. No fabricated assignment and no source records are printed. */
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { backfillFromDisk, defaultRoots } from "../../../packages/telemetry/dist/backfill/index.js";
import { projectAgentCost } from "../../../packages/telemetry/dist/agent-cost.js";
const scan = await backfillFromDisk(defaultRoots(process.env.DSH_TELEMETRY_NATIVE_HOME ?? homedir()), {
  limit: 10, sinceMs: Date.now() - 24 * 60 * 60 * 1000,
});
const at = new Date().toISOString();
const key = run => JSON.stringify([run.source, run.id]);
const counts = new Map();
for (const run of scan.runs) counts.set(key(run), (counts.get(key(run)) ?? 0) + 1);
const unique = scan.runs.filter(run => counts.get(key(run)) === 1);
const rows = unique.map(run => ({ run, cost: projectAgentCost(run, at) }));
const positive = rows.find(({ cost }) => cost.runTokens.availability === "available" &&
  Object.values(cost.runTokens.measurement).some(value => value > 0));
const missing = rows.find(({ run, cost }) => run.usage.costUsd === undefined && cost.meteredSpend.availability === "unavailable" && cost.meteredSpend.reason === "measurement_missing");
// Assertions consume real values privately, and publish only whether the comparisons succeeded.
assert.ok(positive, "live positive token row not found");
assert.ok(missing, "live absent-currency control not found");
for (const [field, value] of Object.entries(positive.cost.runTokens.measurement)) assert.equal(value, positive.run.usage[field]);
assert.equal(missing.cost.meteredSpend.measurement, null);
const metered = rows.find(({ run, cost }) => cost.meteredSpend.availability === "available" && run.usage.costUsd !== undefined);
if (metered) assert.equal(metered.cost.meteredSpend.measurement.amount, metered.run.usage.costUsd);
const child = rows.find(({ run, cost }) => run.parentId !== null && cost.runTokens.availability === "available");
if (child) for (const [field, value] of Object.entries(child.cost.runTokens.measurement)) assert.equal(value, child.run.usage[field]);
const present = new Set(unique.map(key));
const summarize = ({ run, cost }, sample) => ({ sample,
  isNativeChild: run.parentId !== null,
  nativeParentPresentInRead: run.parentId !== null && present.has(JSON.stringify([run.source, run.parentId])),
  rows: Object.fromEntries(Object.entries(cost).map(([name, row]) => [name, {
    kind: row.kind, unit: row.unit, scope: row.scope, availability: row.availability, reason: row.reason,
    measurementPresent: row.measurement !== null, valuesWithheld: true,
    sourceMetadataPresent: row.observedAt !== null && row.revision !== null,
  }])),
});
console.log(JSON.stringify({ verdict: "PASS", scope: "live native cost projection; not a dispatched issue join",
  limit: 10, nativeScanComplete: !scan.degraded, nativeRowsRead: scan.runs.length,
  nonzeroTokensEqualNativeUsage: true, absentCurrencyStayedNull: true,
  samples: [summarize(positive, "resolved-tokens"), summarize(missing, "unavailable-currency"),
    ...(metered ? [summarize(metered, "reported-currency")] : []),
    ...(child ? [summarize(child, "native-child-tokens")] : [])],
}, null, 2));
