/** Child fixture: an IPC acknowledgement names the exact boundary before the parent sends SIGKILL. */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileStateStore } from "./state-store-fs.js";
import { clock, key, SCOPE, value } from "./state-store-test-helpers.js";
const [directory, mode, phase, target] = process.argv.slice(2);
if (!directory) throw new Error("fixture requires its temporary root");
const signal = (event: string, data: object = {}) => process.send?.({ event, ...data });
async function parked(event: string, data: object = {}): Promise<void> {
  signal(event, data);
  await new Promise<void>(resolve => { process.once("message", () => resolve()); });
}
const store = new FileStateStore({ directory, scope: SCOPE, clock,
  onPoint: async point => {
    if (mode === "race" && point.phase === "observed-predecessor") await parked("reached");
    if ((mode === "checkpoint" || mode === "acquire") && point.phase === phase && point.record === target) await parked("reached");
  },
});
const opened = await store.open();
if (mode === "race") {
  await parked("result", { result: opened.ok ? { ok: true, holder: opened.value.holder } : opened });
} else {
  const handle = value(opened);
  if (mode === "holder" || mode === "init-crash") await parked("reached", { holder: handle.holder });
  else if (mode === "checkpoint") {
    // Parent established the old checkpoint. This receipt deliberately lies beyond its cut.
    const state = value(await handle.read());
    if (state.lastEntry === 0) {
      const sent = value(await handle.intent(key("sent")));
      value(await handle.receipt(sent, { delivered: true, reference: "effect-reference" }));
      const unsent = value(await handle.intent(key("unsent")));
      value(await handle.receipt(unsent, { delivered: false, reason: "refused before delivery" }));
    }
    const pending = value(await handle.intent(key("cross-cut")));
    value(await handle.checkpoint()); // The test's selected checkpoint publication stops here.
    value(await handle.receipt(pending, { delivered: true, reference: "cross-cut-reference" }));
    await parked("finished");
  } else if (mode === "intent") {
    const pending = value(await handle.intent(key("attempted")));
    await writeFile(join(directory, "cand.effect-attempted"), "synthetic effect attempted\n");
    await parked("reached", { pending });
  } else if (mode === "acquire") await parked("finished");
}
