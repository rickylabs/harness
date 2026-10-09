/** Live governance collection: read every configured leg through the injected services, compose, and decode. */
import { join } from "node:path";
import type { GovernanceReadSnapshot, RegimeStatus } from "@rickylabs/harness-contracts";
import { mapCapacity } from "../domain/capacity.js";
import { SourceError, type GovernanceSource, type Leg } from "../domain/source.js";
import { mapSpend } from "../domain/spend.js";
import { mapUsage } from "../domain/usage.js";
import type { AdmissionLog, GovernanceWiring, SourceServices } from "../ports/source.js";
import { composeGovernance } from "./compose.js";
import { governanceRead } from "./read.js";
import { mapTransportAvailability } from "./transport-availability.js";
import { usageCommand } from "./usage-command.js";

async function readResponse(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok || response.body === null) throw new SourceError("request-failed");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new SourceError("oversize");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new SourceError("non-json"); }
}
async function isolatedLeg<T = RegimeStatus>(read: () => Promise<Leg<T>>, fallback: "request-failed" | "cgroup-unreadable" | "file-unreadable"): Promise<Leg<T>> {
  try { return await read(); }
  catch (error) { return { ok: false, code: error instanceof SourceError ? error.code : fallback }; }
}
/** Read every configured leg, compose at completion, evaluate at `now`, and decode through the contract.
 * Throws the fixed `governance document unavailable` when the composed document does not decode. */
export async function collectGovernance(source: GovernanceSource, log: AdmissionLog, services: SourceServices, wiring: GovernanceWiring,
  now?: string): Promise<{ observed: GovernanceReadSnapshot; completion: string }> {
  const missing: Leg<RegimeStatus> = { ok: false, code: "not-configured" };
  const [usage, spend, capacity] = await Promise.all([
    isolatedLeg(async () => {
      if (source.usage === null) return missing;
      const credential = services.env[source.usage.credentialEnv]?.trim();
      if (!credential) return { ok: false, code: "credential-unbound" };
      return mapUsage(await services.usage(usageCommand(source.usage, credential)), source.usage, source.accountLabel);
    }, "request-failed"),
    isolatedLeg(async () => {
      if (source.spend === null) return missing;
      const config = source.spend;
      const credential = services.env[config.credentialEnv]?.trim();
      if (!credential) return { ok: false, code: "credential-unbound" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new SourceError("timeout")); }, config.timeoutMs);
      });
      try {
        const read = async (): Promise<unknown> => readResponse(await services.fetch(config.url, {
          headers: { accept: "application/json", authorization: `Bearer ${credential}` }, redirect: "error", signal: controller.signal,
        }), config.maxBytes);
        const payload = await Promise.race([read(), timeout]);
        return mapSpend(payload, config, services.clock());
      } finally { clearTimeout(timer); controller.abort(); }
    }, "request-failed"),
    isolatedLeg(async () => {
      if (source.capacity === null) return missing;
      const config = source.capacity;
      const [current, max] = await Promise.all([
        services.readText(join(config.cgroupRoot, "memory.current"), 128),
        services.readText(join(config.cgroupRoot, "memory.max"), 128),
      ]);
      return mapCapacity(current, max, config, services.clock());
    }, "cgroup-unreadable"),
  ]);
  const transportAvailability = source.transportAvailability
    ? await isolatedLeg(async () => mapTransportAvailability(await services.readPrivateText(source.transportAvailability!.path)), "file-unreadable")
    : undefined;
  const completion = services.clock();
  return { observed: governanceRead(composeGovernance(source, { usage, spend, capacity, events: log.files.flatMap(file => file.events),
    logDegraded: log.degraded, ...(transportAvailability === undefined ? {} : { transportAvailability }) }, wiring, completion, now ?? completion)),
  completion };
}
