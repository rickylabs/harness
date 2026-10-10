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

it("refuses a root with repeated separators: the stored path must already be normalized", () => {
  for (const value of ["file:///workspace//project", "file:///workspace/project//src", "file:////workspace"]) {
    assert.equal(agyWorkspaceRoot(JSON.stringify([value])), null, value);
  }
});

it("refuses a root with an encoded control character", () => {
  for (const code of ["%00", "%01", "%0A", "%1F", "%7F"]) {
    assert.equal(agyWorkspaceRoot(JSON.stringify([`file:///workspace/pro${code}ject`])), null, code);
  }
});
