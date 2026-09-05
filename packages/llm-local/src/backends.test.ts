import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKENDS,
  BACKEND_RECORDS,
  backendRecord,
  backendsWhere,
  isBackend,
} from "./backends.js";

describe("the backend table", () => {
  it("describes every backend exactly once", () => {
    assert.equal(BACKEND_RECORDS.length, BACKENDS.length);
    const named = BACKEND_RECORDS.map((record) => record.backend);
    assert.equal(new Set(named).size, named.length);
    for (const backend of BACKENDS) {
      assert.notEqual(backendRecord(backend), null, backend);
    }
  });

  it("refuses a name it does not describe, including inherited object properties", () => {
    assert.equal(backendRecord("ollama"), null);
    assert.equal(backendRecord(""), null);
    assert.equal(backendRecord("toString"), null);
    assert.equal(isBackend("constructor"), false);
    assert.equal(isBackend("lm-studio"), true);
  });

  it("orders on-box before relay, because a request that can stay on the box should", () => {
    const localities: string[] = BACKEND_RECORDS.map((record) => record.locality);
    assert.equal(localities.indexOf("relay") > localities.lastIndexOf("on-box"), true);
    assert.deepEqual(backendsWhere("on-box"), ["lm-studio", "llama-rocm"]);
    assert.deepEqual(backendsWhere("relay"), ["openrouter"]);
  });

  it("separates the two local accelerators, because a model can run on one and not the other", () => {
    assert.equal(backendRecord("lm-studio")?.accelerator, "vulkan");
    assert.equal(backendRecord("llama-rocm")?.accelerator, "rocm");
    assert.equal(backendRecord("openrouter")?.accelerator, "none");
  });

  it("gives every backend a diagnostics path, and points LM Studio away from container logs", () => {
    for (const record of BACKEND_RECORDS) {
      assert.notEqual(record.diagnostics.trim(), "", record.backend);
      assert.notEqual(record.why.trim(), "", record.backend);
    }
    // The failure this field exists for: a model that fails to load leaves the container's stdout
    // looking healthy, so `nerdctl logs` is the wrong place to look and the record must not imply it.
    const lmStudio = backendRecord("lm-studio");
    assert.equal(lmStudio?.diagnostics.includes(".lmstudio/server-logs"), true);
  });

  it("admits exactly one way to establish readiness", () => {
    // llama-rocm's entrypoint is `sleep infinity`, so container state says nothing about the
    // server. There is no member to select that would let a caller express the wrong check.
    for (const record of BACKEND_RECORDS) {
      assert.equal(record.readiness, "endpoint", record.backend);
    }
  });

  it("marks only the relay as credentialed", () => {
    assert.equal(backendRecord("openrouter")?.credentialed, true);
    assert.equal(backendRecord("lm-studio")?.credentialed, false);
    assert.equal(backendRecord("llama-rocm")?.credentialed, false);
  });

  it("carries no credential value, only the fact that one is needed", () => {
    const serialised = JSON.stringify(BACKEND_RECORDS);
    for (const secret of ["sk-", "Bearer ", "openrouter.env", "auth.json"]) {
      assert.equal(serialised.includes(secret), false, secret);
    }
  });

  it("speaks one wire protocol everywhere, which is why one adapter can serve all three", () => {
    for (const record of BACKEND_RECORDS) {
      assert.equal(record.api, "openai-completions", record.backend);
      assert.equal(record.defaultBaseUrl.endsWith("/v1"), true, record.backend);
    }
  });
});
