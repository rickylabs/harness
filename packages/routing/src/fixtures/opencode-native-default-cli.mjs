#!/usr/bin/env node
/** Disposable fake metadata boundary; data is supplied only through the test cwd. */
import { readFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:http";
const data = JSON.parse(readFileSync("data.json", "utf8"));
const { behavior } = data, args = process.argv.slice(2);
const note = value => appendFileSync("commands.jsonl", JSON.stringify(value) + "\n");
note({ args, pid: process.pid });
if (args[0] === "--version") {
  console.log(["unverified", "header-only"].includes(behavior) ? data.unverifiedVersion : data.version);
  process.exit(0);
}
if (args[0] === "models") {
  for (const original of data.models) {
    if (behavior === "header-only") { console.log(original.providerID + "/" + original.id); continue; }
    const m = structuredClone(original);
    if (behavior === "missing") delete m.variants;
    if (behavior === "opaque") m.variants = data.opaqueVariants;
    if (behavior === "disabled") m.variants = data.disabledVariants;
    if (behavior === "null") m.variants = null;
    if (behavior === "array") m.variants = [];
    if (behavior === "id-mismatch") m.id = data.models[3].id;
    if (behavior === "provider-mismatch") m.providerID = data.models[3].providerID;
    console.log(original.providerID + "/" + original.id);
    console.log(behavior === "duplicate"
      ? '{"id":' + JSON.stringify(m.id) + ',"providerID":' + JSON.stringify(m.providerID) + ',"variants":{},"variants":{}}'
      : JSON.stringify(m));
  }
  process.exit(0);
}
if (args[0] !== "serve") process.exit(2);
const server = createServer((req, res) => {
  const authorized = req.headers.authorization === "Basic " + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ":" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
  note({ endpoint: req.url, authorized });
  if (!["/provider", "/config/providers"].includes(req.url) || !authorized || (req.url === "/provider" && behavior === "auth-failed")) {
    res.writeHead(403); res.end(); return;
  }
  if (req.url === "/config/providers") {
    const models = data.models.map(original => {
      const m = structuredClone(original);
      if (behavior === "missing") delete m.variants;
      if (behavior === "opaque") m.variants = data.opaqueVariants;
      if (behavior === "disabled") m.variants = data.disabledVariants;
      if (behavior === "null") m.variants = null;
      if (behavior === "array") m.variants = [];
      if (behavior === "id-mismatch") m.id = data.models[3].id;
      if (behavior === "provider-mismatch") m.providerID = data.models[3].providerID;
      return m;
    });
    const providers = [...new Set(data.models.map(m => m.providerID))].map(id => ({ id,
      models: Object.fromEntries(data.models.map((m, i) => ({ m, i })).filter(v => v.m.providerID === id).map(v => [v.m.id, models[v.i]])) }));
    let body = JSON.stringify({ providers });
    if (behavior === "duplicate") body = body.replace('"variants":{}', '"variants":{},"variants":{}');
    res.end(body); return;
  }
  res.end(JSON.stringify({ connected: data.connections }));
});
server.listen(0, "127.0.0.1", () => console.log("opencode server listening on http://127.0.0.1:" + server.address().port));
