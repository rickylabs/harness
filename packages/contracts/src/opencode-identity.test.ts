import assert from "node:assert/strict";
import { it } from "node:test";
import { openCodeModelSyntax, publicOpenCodeModel } from "./opencode-identity.js";
it("OpenCode model metadata preserves nested/colon/tilde identifiers with exact provider syntax", () => {
  const provider = "fixture-provider";
  for (const model of ["fixture-model", "~fixture-preview", "nested/model:1", "a".repeat(256), "~" + "a".repeat(256)]) {
    const value = provider + "/" + model;
    assert.equal(openCodeModelSyntax(value, provider), true);
    assert.equal(publicOpenCodeModel(value, provider), true);
  }
  for (const value of ["foreign/model", provider + "/a b", provider + "/" + "a".repeat(258), provider + "/~/home", "/root/model"]) {
    assert.equal(openCodeModelSyntax(value, provider), false);
  }
});
it("OpenCode public metadata withholds private paths/secrets even if native syntax admits the route", () => {
  for (const model of ["fixture-provider/home/agent/private", "fixture-provider/github_pat_fixture", "fixture-provider/../model"]) {
    assert.equal(publicOpenCodeModel(model, "fixture-provider"), false);
  }
});

import { compareRouteIdentity, projectRouteIdentity } from "./route.js";
it("OpenCode route projection applies screening without falling back to generic model labels", () => {
  for (const model of ["fixture-provider/home/agent/private", "fixture-provider/github_pat_fixture", "fixture-provider/../model"]) {
    const route = { provider: "fixture-provider", model, effort: "high", cwd: null };
    const projected = projectRouteIdentity(compareRouteIdentity(route, route, "opencode"));
    assert.equal(projected.requested.model.value, null);
    assert.equal(projected.observed.model.value, null);
    assert.ok(!JSON.stringify(projected).includes(model));
  }
  const route = { provider: "fixture-provider", model: "fixture-provider/nested/model:1", effort: "high", cwd: null };
  assert.equal(projectRouteIdentity(compareRouteIdentity(route, route, "opencode")).requested.model.value, route.model);
  assert.equal(projectRouteIdentity(compareRouteIdentity(route, route)).requested.model.value, null);
});

it("Partial route metadata stays unknown rather than throwing before screening", () => {
  for (const raw of [null, {}, { requested: {} }, { observed: {} }, { requested: { model: { source: "request.model", value: "fixture" } } }]) {
    assert.equal(projectRouteIdentity(raw).status, "unknown");
  }
});
