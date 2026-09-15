import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { codexThreadEvidence } from "../../../packages/telemetry/dist/codex-threads.js";
const args = ["packages/telemetry/dist/cli.js", "codex-threads", "--limit", "1", "--json"];
let result;
try { result = { ...(await promisify(execFile)(process.execPath, args, { timeout: 30000, maxBuffer: 1048576 })), code: 0 }; }
catch (error) { result = { code: typeof error.code === "number" ? error.code : null, stdout: error.stdout ?? "" }; }
try {
 const value = JSON.parse(result.stdout);
 console.log(JSON.stringify({ command: "node " + args.join(" "), exit_code: result.code, output: codexThreadEvidence(value) }));
 if (result.code !== 3 || value.rows.length !== 1 || value.complete || value.reason !== "scan_limit") process.exitCode = 1;
} catch { console.log(JSON.stringify({ verdict: "INCONCLUSIVE", reason: "cli_payload_unavailable" })); process.exitCode = 3; }
