import assert from "node:assert/strict";
import { it } from "node:test";
import { agyWorkspaceRoot } from "../../src/application/workspace-root.js";

const WS = "/workspace/project";
it("relativizes only against exactly one local root (S25-S27, G42)", () => {
  assert.equal(agyWorkspaceRoot(JSON.stringify([`file://${WS}`])), WS);
  for (const value of ["not json", JSON.stringify({ root: `file://${WS}` }), "[1]", JSON.stringify([`file://${WS}`, "file:///other"]),
    JSON.stringify(["vscode-remote://host/workspace"]), JSON.stringify(["file:///a/../b"]), JSON.stringify(["file:///"]), null, ""]) {
    assert.equal(agyWorkspaceRoot(value), null, String(value));
  }
});
