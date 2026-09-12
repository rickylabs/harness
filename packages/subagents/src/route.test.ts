import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ROUTE_FIELDS,
  compareRouteIdentity,
  isRouteEvidenceVerified,
  type RouteField,
  type RouteIdentityInput,
} from "./route.js";

const REQUESTED: RouteIdentityInput = {
  provider: "openai",
  model: "gpt-test",
  effort: "medium",
  cwd: "/work/repo",
};

function withField(input: RouteIdentityInput, field: RouteField, value: unknown): RouteIdentityInput {
  return { ...input, [field]: value };
}

describe("compareRouteIdentity", () => {
  it("verifies all four exact values and records closed provenance", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    assert.equal(evidence.status, "known");
    assert.deepEqual(evidence.mismatches, []);
    assert.deepEqual(evidence.invalid, []);
    assert.equal(isRouteEvidenceVerified(evidence), true);
    assert.match(evidence.detail, /request\.modelProvider/);
    assert.match(evidence.detail, /thread\/start\.result\.reasoningEffort/);
    assert.match(evidence.detail, /provider\.cwd/);
    assert.match(evidence.detail, /thread\/start\.result\.cwd/);
  });

  for (const [field, value] of [
    ["provider", "other-provider"],
    ["model", "other-model"],
    ["effort", "high"],
    ["cwd", "/work/other"],
  ] as const) {
    it(`reports an exact ${field} mismatch with both values and sources`, () => {
      const evidence = compareRouteIdentity(REQUESTED, withField(REQUESTED, field, value));
      assert.equal(evidence.status, "mismatch");
      assert.deepEqual(evidence.mismatches, [field]);
      assert.match(evidence.detail, new RegExp(`${field} requested`));
      assert.match(evidence.detail, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(evidence.detail, /correct the requested route or server configuration before retry/);
      assert.match(evidence.detail, /unchanged settings may produce the same refusal/);
      assert.equal(isRouteEvidenceVerified(evidence), false);
    });
  }

  it("reports combined mismatches in stable field order", () => {
    const evidence = compareRouteIdentity(REQUESTED, {
      provider: "p",
      model: "m",
      effort: "e",
      cwd: "/c",
    });
    assert.equal(evidence.status, "mismatch");
    assert.deepEqual(evidence.mismatches, ROUTE_FIELDS);
  });

  for (const field of ROUTE_FIELDS) {
    for (const [label, value] of [
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["blank", "  "],
      ["wrong type", 42],
    ] as const) {
      it(`makes ${label} observed ${field} unknown`, () => {
        const evidence = compareRouteIdentity(REQUESTED, withField(REQUESTED, field, value));
        assert.equal(evidence.status, "unknown");
        assert.deepEqual(evidence.invalid, [{ side: "observed", field }]);
        assert.equal(evidence.observed[field].value, null);
        assert.equal(isRouteEvidenceVerified(evidence), false);
      });
    }
  }

  it("keeps known differences visible when another field is invalid", () => {
    const evidence = compareRouteIdentity(REQUESTED, {
      ...REQUESTED,
      provider: "other-provider",
      effort: null,
    });
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.mismatches, ["provider"]);
    assert.deepEqual(evidence.invalid, [{ side: "observed", field: "effort" }]);
    assert.match(evidence.detail, /invalid observed effort/);
    assert.match(evidence.detail, /provider requested "openai".*observed "other-provider"/);
  });

  for (const [label, observed] of [
    ["provider case", { ...REQUESTED, provider: "OpenAI" }],
    ["provider alias", { ...REQUESTED, provider: "open-ai" }],
    ["effort case", { ...REQUESTED, effort: "Medium" }],
    ["trailing space", { ...REQUESTED, model: "gpt-test " }],
    ["equivalent-looking cwd", { ...REQUESTED, cwd: "/work/repo/." }],
  ] as const) {
    it(`treats ${label} as mismatch rather than normalising it`, () => {
      assert.equal(compareRouteIdentity(REQUESTED, observed).status, "mismatch");
    });
  }

  it("will not certify a relative requested cwd", () => {
    const evidence = compareRouteIdentity({ ...REQUESTED, cwd: "work/repo" }, {
      ...REQUESTED,
      cwd: "work/repo",
    });
    assert.equal(evidence.status, "unknown");
    assert.deepEqual(evidence.invalid, [{ side: "requested", field: "cwd" }]);
  });

  it("rejects a contradictory fabricated known status", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    const contradictory = {
      ...evidence,
      observed: {
        ...evidence.observed,
        model: { ...evidence.observed.model, value: "other-model" },
      },
    };
    assert.equal(isRouteEvidenceVerified(contradictory), false);
    assert.equal(isRouteEvidenceVerified(undefined), false);
  });

  it("rejects fabricated known evidence with blank values", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    const blank = {
      ...evidence,
      requested: {
        ...evidence.requested,
        model: { ...evidence.requested.model, value: "" },
      },
      observed: {
        ...evidence.observed,
        model: { ...evidence.observed.model, value: "" },
      },
    };
    assert.equal(isRouteEvidenceVerified(blank), false);
  });

  it("rejects fabricated known evidence with a relative cwd", () => {
    const evidence = compareRouteIdentity(REQUESTED, REQUESTED);
    const relative = {
      ...evidence,
      requested: {
        ...evidence.requested,
        cwd: { ...evidence.requested.cwd, value: "work/repo" },
      },
      observed: {
        ...evidence.observed,
        cwd: { ...evidence.observed.cwd, value: "work/repo" },
      },
    };
    assert.equal(isRouteEvidenceVerified(relative), false);
  });
});

describe("the dialect argument — additive, and the codex path is byte-identical without it", () => {
  // #287 gave `compareRouteIdentity` a third parameter. Every call site that predates it — the codex
  // provider at `provider-codex/src/protocol.ts` and `dsh-app/src/dry-run-internal.ts` — passes two
  // arguments and must keep both compiling and behaving. This is the regression that says so.

  it("defaults to codex, producing exactly what the two-argument call produced before", () => {
    const implicit = compareRouteIdentity(REQUESTED, REQUESTED);
    const explicit = compareRouteIdentity(REQUESTED, REQUESTED, "codex");

    assert.deepEqual(implicit, explicit);
    assert.equal(implicit.observed.model.source, "thread/start.result.model");
    assert.equal(implicit.observed.provider.source, "thread/start.result.modelProvider");
    assert.equal(implicit.observed.effort.source, "thread/start.result.reasoningEffort");
    assert.equal(implicit.observed.cwd.source, "thread/start.result.cwd");
    assert.equal(isRouteEvidenceVerified(implicit), true);
  });

  it("changes the labels and nothing else about the comparison", () => {
    // The negative control on the same input: the uhp dialect relabels, and because three of its labels
    // are null it can never verify — while the values compared, and therefore the mismatches, are the
    // same values in both. A dialect that changed `mismatches` would be deciding, not labelling.
    const codex = compareRouteIdentity(REQUESTED, { ...REQUESTED, model: "other-model" }, "codex");
    const uhp = compareRouteIdentity(REQUESTED, { ...REQUESTED, model: "other-model" }, "uhp");

    assert.deepEqual(codex.mismatches, ["model"]);
    assert.deepEqual(uhp.mismatches, ["model"]);
    assert.deepEqual(codex.invalid, uhp.invalid);
    assert.equal(codex.status, uhp.status);

    assert.notEqual(codex.observed.model.source, uhp.observed.model.source);
    assert.equal(uhp.observed.model.source, "uhp/responses.result.model");
    assert.equal(uhp.observed.provider.source, null);
  });

  it("verifies a codex route and refuses the identical values labelled as uhp", () => {
    // Identical values, identical `status: "known"`, opposite answers — because three UHP fields have no
    // source, and a field with no source has nothing to have agreed. The pair is the point: without the
    // codex half, the uhp half would also pass for a predicate that refused everything.
    const codex = compareRouteIdentity(REQUESTED, REQUESTED, "codex");
    const uhp = compareRouteIdentity(REQUESTED, REQUESTED, "uhp");

    assert.equal(codex.status, "known");
    assert.equal(uhp.status, "known");
    assert.equal(isRouteEvidenceVerified(codex), true);
    assert.equal(isRouteEvidenceVerified(uhp), false);
  });

  it("refuses a mixed labelling, so a codex label cannot ride in on a uhp route", () => {
    // The loosening this guard exists to prevent is `ROUTE_SOURCES.includes(source)` — "any label in the
    // union". Under that reading the fabrication below verifies, because every label in it is a real
    // member of `RouteSource`. Under a per-dialect reading it matches no row and is refused.
    const codex = compareRouteIdentity(REQUESTED, REQUESTED, "codex");
    const smuggled = {
      ...codex,
      observed: {
        ...codex.observed,
        model: { value: codex.observed.model.value, source: "uhp/responses.result.model" as const },
      },
    };

    assert.equal(smuggled.observed.model.value, codex.observed.model.value);
    assert.equal(isRouteEvidenceVerified(codex), true);
    assert.equal(isRouteEvidenceVerified(smuggled), false);
  });

  it("refuses an observed side labelled with a requested-side source", () => {
    // Found by mutation N3: with the dialect match weakened from "every field" to "any field", a row that
    // matched codex on three fields and carried a *requested* label on the fourth still claimed the codex
    // dialect and verified. `request.model` is a real member of `RouteSource`, so nothing about it looks
    // malformed — it simply says the observation came from the request, which is the one place an
    // observation cannot come from. Every observed label must belong to the row, not merely most of them.
    const codex = compareRouteIdentity(REQUESTED, REQUESTED, "codex");
    const selfReported = {
      ...codex,
      observed: {
        ...codex.observed,
        model: { value: codex.observed.model.value, source: "request.model" as const },
      },
    };

    assert.equal(isRouteEvidenceVerified(codex), true);
    assert.equal(isRouteEvidenceVerified(selfReported), false);
  });

  it("refuses a uhp route whose unreportable fields have been given values anyway", () => {
    // The fabrication a null source is there to refuse: someone writes a provider, effort and cwd beside
    // the three labels that do not exist, and `status` reads `known` because the strings agree. The
    // values came from nowhere this vocabulary can name, and the predicate says so.
    const uhp = compareRouteIdentity(REQUESTED, REQUESTED, "uhp");

    assert.equal(uhp.status, "known");
    assert.equal(uhp.observed.provider.value, "openai");
    assert.equal(uhp.observed.provider.source, null);
    assert.equal(isRouteEvidenceVerified(uhp), false);
  });

  it("renders a missing source as an absence rather than as the word null", () => {
    const uhp = compareRouteIdentity(REQUESTED, { ...REQUESTED, provider: undefined }, "uhp");
    assert.match(uhp.detail, /invalid observed provider \(unreported by this protocol\)/);
    assert.doesNotMatch(uhp.detail, /\(null\)/);
    assert.doesNotMatch(uhp.detail, /thread\/start/);
  });
});
