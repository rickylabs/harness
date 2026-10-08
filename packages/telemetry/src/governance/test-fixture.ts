/**
 * One synthetic governance read document for the CLI, render and public tests: subscription quota,
 * metered spend, host capacity and one refused admission, all consistent with the published decoder.
 * Times are relative to `evaluatedAt`, so each test chooses its own clock. Test support only.
 */
const at = (base: number, minutes: number): string => new Date(base + minutes * 60_000).toISOString();

export function governanceDocument(evaluatedAt: string, usedPercent = 63): Record<string, unknown> {
  const base = Date.parse(evaluatedAt);
  const observed = at(base, -5), meterUntil = at(base, 5), admissionUntil = at(base, 1);
  const read = (provenance: string) => ({ status: "read", observedAt: observed, validUntil: meterUntil, freshness: "fresh", provenance });
  return {
    schema: 1, protocol: 1, producer: "harness-telemetry", evaluatedAt,
    sources: { usage: read("synthetic:usage"), spend: read("synthetic:spend"), capacity: read("synthetic:capacity"),
      admissions: { status: "read", records: 1, empty: false, dropped: [], provenance: "synthetic:admissions", collectedAt: observed },
      approvals: { status: "not-observed" } },
    notes: [], availability: "fresh", observedAt: observed, validUntil: admissionUntil, provenance: "synthetic:test", complete: true,
    state: { generatedAt: observed, pending: [], notes: [], regimes: [
      { regime: "subscription", state: "throttle", note: "paced against binding window", accounts: [{ seam: "codex", account: "primary",
        state: "throttle", observedAt: observed,
        windows: [{ label: "5h", windowMinutes: 300, usedPercent, resetsAt: at(base, 60), binding: true }] }] },
      { regime: "metered", state: "allow", note: null,
        providers: [{ provider: "openrouter", spentUsd: 12.5, ceilingUsd: 50, windowLabel: "monthly", observedAt: observed }] },
      { regime: "capacity", state: "allow", note: null, hosts: [{ host: "n5-fixture", vramUsedBytes: 8 * 1024 ** 3,
        vramTotalBytes: 24 * 1024 ** 3, ramUsedBytes: 32 * 1024 ** 3, ramTotalBytes: 128 * 1024 ** 3, observedAt: observed }] },
    ] },
    admissions: [{ item: 205, regime: "subscription", state: "throttle", observedAt: at(base, -6), validUntil: admissionUntil,
      freshness: "fresh", provenance: "synthetic:dispatcher", reason: "quota-paced", accepted: false }],
    unavailableReason: null,
  };
}
