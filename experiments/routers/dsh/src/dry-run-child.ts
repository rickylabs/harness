/** Synthetic coordinator child only: no provider process, transport, or external work. */
import { FileStateStore } from "@rickylabs/coordinator";
import { driveSnapshot } from "./dry-run-internal.js";
import { clock, fixture, SCOPE, value } from "./dry-run-test-fixtures.js";
const [directory, phase] = process.argv.slice(2);
if (!directory || !["assembled", "attempted"].includes(phase ?? "")) throw new Error("invalid test phase");
const handle = value(await new FileStateStore({ directory, scope: SCOPE, clock }).open());
const pause = async (key: unknown): Promise<void> => {
  process.send?.({ event: "reached", key, holder: handle.holder });
  await new Promise<void>(() => {});
};
// IPC keeps the child alive at the exact boundary until its test parent sends real SIGKILL.
process.on("message", () => {});
await driveSnapshot(handle, structuredClone(fixture()), phase === "assembled" ? { assembled: pause } : { attempted: pause });
throw new Error("test boundary was not reached");
