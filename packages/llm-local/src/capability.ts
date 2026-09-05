/**
 * Which model can run on which backend — and, more usefully, which cannot and why.
 *
 * Local availability is not symmetric with hosted, and the asymmetries are not guessable from the
 * model id. A model can be open-weights, popular, and served everywhere else, and still be absent
 * from the llama.cpp build this box compiles; another can be present, load cleanly, and segfault on
 * one of the two accelerators. Each of those cost a debugging session to find. Written as prose in
 * an epic they cost the next person the same session, so they are written here as entries a caller
 * can consult and a test can check.
 *
 * ## Three verdicts, not two
 *
 * `runs` and `refused` are the interesting ones. `unverified` exists because the alternative to
 * having it is worse: with only two verdicts, every pair nobody has tried has to be filed as one or
 * the other, and both are lies. A `refused` we cannot justify blocks a route that might be fine; a
 * `runs` we have not observed sends a dispatch somewhere it may die. `unverified` is the honest
 * answer for most of this table, and a caller that treats it as "do not route here without probing"
 * is behaving correctly.
 *
 * The distinction also keeps `checkCapability` meaningful. Totality over models x backends is
 * enforced, so a new pin cannot silently have no placement — but totality is only worth enforcing
 * if the filler value is allowed to say "unknown" rather than forcing a fabricated verdict.
 *
 * ## Why the model ids come from `routing`
 *
 * `@rickylabs/routing` owns every model id; this package owns where each one can be sent. Spelling
 * an id here as a string literal would create a second table naming models, and then two answers to
 * "which model did that run use". The dependency runs in this direction only: routing does not know
 * a backend exists, because choosing a model and finding a socket are different questions and the
 * package that answers the first must not be able to be influenced by the second.
 *
 * ## What is deliberately not in this table
 *
 * Quota, spend, and load. All three change while you read them, and a committed copy is wrong by
 * the time it ships — this is the epic's hard rule and the reason capability is separated from
 * availability. This table answers *could this ever work here*; whether it works right now is a
 * probe, and probes belong to #57 and #59.
 *
 * `moonshotai/kimi-k3` is also absent, though `routing` pins it. It is reached through opencode's
 * own router on the `ctx.subagents` seam, so no `ctx.llm` adapter ever addresses it. Listing it
 * would imply this package could send it somewhere, and it cannot.
 */

import { LOCAL_MODEL_IDS, OPENROUTER_MODEL_IDS, isPinnedModel } from "@rickylabs/routing";

import { BACKENDS } from "./backends.js";
import type { Backend } from "./backends.js";

/**
 * Why a model must not be sent to a backend.
 *
 * Each member is a distinct remedy, which is the test for whether it deserves to exist:
 * `absent-from-build` is fixed by rebuilding, `crashes-on-backend` by using the other accelerator,
 * `unusably-slow` by not routing there at all, and `not-served-here` never — it is a fact about
 * what the destination is, not about how it is configured.
 */
export const REFUSALS = [
  "absent-from-build",
  "crashes-on-backend",
  "unusably-slow",
  "not-served-here",
] as const;
export type Refusal = (typeof REFUSALS)[number];

/** Extra conditions a model needs before it will load on a backend. */
export interface Requirements {
  /** Environment the server process needs. Values are settings, never credentials. */
  readonly env?: Readonly<Record<string, string>>;
  /** Arguments the server must be started with. */
  readonly args?: readonly string[];
}

interface PlacementBase {
  readonly model: string;
  readonly backend: Backend;
  /** Always present. An entry that cannot say why it says what it says is not evidence. */
  readonly why: string;
}

/** One (model, backend) cell of the matrix. */
export type Placement =
  | (PlacementBase & { readonly verdict: "runs"; readonly requires?: Requirements })
  | (PlacementBase & { readonly verdict: "refused"; readonly reason: Refusal })
  | (PlacementBase & { readonly verdict: "unverified" });

/** The `n5air/` namespace names weights served from this box; the relay has no such id. */
const NOT_ON_THE_RELAY =
  "The `n5air/` prefix names a model served from this box. The relay has no id under that " +
  "namespace, so this is a fact about what the destination is rather than a configuration gap.";

/** Nothing has tried it, and a verdict we have not observed is not one worth recording. */
const UNTRIED =
  "Nothing has run this pair. Treat it as a probe to perform, not as a route to take.";

/**
 * The matrix.
 *
 * Grouped by model rather than by backend, because the question a caller asks is "where can I send
 * this" far more often than "what can this box serve".
 */
export const PLACEMENTS: readonly Placement[] = [
  // ---- Local weights -----------------------------------------------------------------------
  {
    model: LOCAL_MODEL_IDS.planEvaluator,
    backend: "lm-studio",
    verdict: "runs",
    why:
      "The good local model on the Vulkan path, around 40 tok/s, and the seat the local smoke and " +
      "plan-evaluation lanes are meant to use. Fast enough that routing here is a real choice " +
      "rather than a fallback.",
  },
  {
    model: LOCAL_MODEL_IDS.planEvaluator,
    backend: "llama-rocm",
    verdict: "unverified",
    why: UNTRIED,
  },
  {
    model: LOCAL_MODEL_IDS.planEvaluator,
    backend: "openrouter",
    verdict: "refused",
    reason: "not-served-here",
    why: NOT_ON_THE_RELAY,
  },

  {
    model: LOCAL_MODEL_IDS.implEvaluator,
    backend: "llama-rocm",
    verdict: "runs",
    requires: {
      env: { GGML_HIP_ENABLE_UNIFIED_MEMORY: "1" },
      args: ["--load-mode", "none"],
    },
    why:
      "ROCm is the only accelerator this model runs on, and it needs unified memory enabled and " +
      "the model left unloaded at start. Both conditions are part of the placement: without them " +
      "the server comes up and the first request fails, which reads as a model fault.",
  },
  {
    model: LOCAL_MODEL_IDS.implEvaluator,
    backend: "lm-studio",
    verdict: "refused",
    reason: "unusably-slow",
    why:
      "It segfaults on Vulkan, and LM Studio's answer to that is a CPU fallback at roughly 3 tok/s " +
      "— which is worse than a refusal, because it succeeds. A lane routed here does not fail; it " +
      "takes an hour and looks like a hung agent.",
  },
  {
    model: LOCAL_MODEL_IDS.implEvaluator,
    backend: "openrouter",
    verdict: "refused",
    reason: "not-served-here",
    why: NOT_ON_THE_RELAY,
  },

  // ---- Relay weights -----------------------------------------------------------------------
  {
    model: OPENROUTER_MODEL_IDS.implEvaluator,
    backend: "openrouter",
    verdict: "runs",
    why:
      "The relay implementation evaluator. It reasons before it answers, which is where the token " +
      "budget floor in `budget.ts` comes from: 71 reasoning tokens consumed a 10-token budget " +
      "entirely and the call returned HTTP 200 with empty content.",
  },
  {
    model: OPENROUTER_MODEL_IDS.implEvaluator,
    backend: "lm-studio",
    verdict: "refused",
    reason: "absent-from-build",
    why:
      "`glm5next` is not in this box's llama.cpp build, so the weights cannot be loaded by either " +
      "local backend. This model is relay-only until that build gains the architecture.",
  },
  {
    model: OPENROUTER_MODEL_IDS.implEvaluator,
    backend: "llama-rocm",
    verdict: "refused",
    reason: "absent-from-build",
    why:
      "Same missing `glm5next` architecture. The accelerator is not the obstacle here, which is " +
      "why swapping to ROCm does not help and the refusal is not `crashes-on-backend`.",
  },

  {
    model: OPENROUTER_MODEL_IDS.planEvaluator,
    backend: "openrouter",
    verdict: "runs",
    why: "The relay plan evaluator, and the seat the local plan evaluator mirrors.",
  },
  { model: OPENROUTER_MODEL_IDS.planEvaluator, backend: "lm-studio", verdict: "unverified", why: UNTRIED },
  { model: OPENROUTER_MODEL_IDS.planEvaluator, backend: "llama-rocm", verdict: "unverified", why: UNTRIED },

  {
    model: OPENROUTER_MODEL_IDS.designGlm,
    backend: "openrouter",
    verdict: "runs",
    why: "Leads design work over the relay. Not an evaluator seat; see `routing`'s approval list.",
  },
  {
    model: OPENROUTER_MODEL_IDS.designGlm,
    backend: "lm-studio",
    verdict: "unverified",
    why:
      "Untried. The `glm5next` gap that rules out GLM-5.3-Flash is a fact about that architecture " +
      "and does not carry over to this one, so it is not evidence either way.",
  },
  { model: OPENROUTER_MODEL_IDS.designGlm, backend: "llama-rocm", verdict: "unverified", why: UNTRIED },

  {
    model: OPENROUTER_MODEL_IDS.grok,
    backend: "openrouter",
    verdict: "runs",
    why: "Relay-only by construction: the weights are not published, so there is nothing to serve locally.",
  },
  {
    model: OPENROUTER_MODEL_IDS.grok,
    backend: "lm-studio",
    verdict: "refused",
    reason: "not-served-here",
    why: "Closed weights. No local backend can serve them, regardless of build or accelerator.",
  },
  {
    model: OPENROUTER_MODEL_IDS.grok,
    backend: "llama-rocm",
    verdict: "refused",
    reason: "not-served-here",
    why: "Closed weights, as above.",
  },
];

// A key that cannot be forged by a model id containing the separator: JSON tuples do not collide.
const cell = (model: string, backend: string): string => JSON.stringify([model, backend]);

const PLACEMENT_BY_CELL: ReadonlyMap<string, Placement> = new Map(
  PLACEMENTS.map((placement): readonly [string, Placement] => [
    cell(placement.model, placement.backend),
    placement,
  ]),
);

/** The verdict for a pair, or `null` for a pair this table does not describe. */
export function placementOf(model: string, backend: string): Placement | null {
  return PLACEMENT_BY_CELL.get(cell(model, backend)) ?? null;
}

/**
 * Whether a model is known to run on a backend.
 *
 * Fails closed on both unknown pairs and `unverified` ones: this answers "may I dispatch here
 * without probing first", and for an untried pair the answer is no.
 */
export function canRun(model: string, backend: string): boolean {
  return placementOf(model, backend)?.verdict === "runs";
}

/** Why a pair is refused, or `null` if it is not refused (including when it is merely untried). */
export function refusalOf(model: string, backend: string): Refusal | null {
  const placement = placementOf(model, backend);
  return placement !== null && placement.verdict === "refused" ? placement.reason : null;
}

/**
 * The backends a model is known to run on, on-box first.
 *
 * The ordering is the routing preference and it is not arbitrary: on-box capacity is a queue that
 * refills and relay capacity is a balance that does not, so a request that can stay on the box
 * should. `BACKENDS` is already ordered that way and this preserves it.
 */
export function backendsFor(model: string): readonly Backend[] {
  return BACKENDS.filter((backend) => canRun(model, backend));
}

/** Every model the matrix places, in table order, without repeats. */
export function placedModels(): readonly string[] {
  const models: string[] = [];
  for (const placement of PLACEMENTS) {
    if (!models.includes(placement.model)) models.push(placement.model);
  }
  return models;
}

/** Something wrong with the table itself. */
export interface CapabilityProblem {
  readonly model: string;
  readonly backend?: Backend;
  readonly message: string;
}

/**
 * Every invariant the matrix must satisfy, checked against the table.
 *
 * The same reasoning as `routing`'s `checkPolicy`: a hand-maintained table ported out of an epic
 * is only trustworthy if the properties that make it trustworthy are executable. The one that
 * earns its keep is totality — a model gains a pin in `routing`, nobody adds its placements, and
 * every query about it quietly answers "not here" instead of "I do not know".
 */
export function checkCapability(): readonly CapabilityProblem[] {
  const problems: CapabilityProblem[] = [];

  const seen = new Set<string>();
  for (const placement of PLACEMENTS) {
    const key = cell(placement.model, placement.backend);
    if (seen.has(key)) {
      problems.push({
        model: placement.model,
        backend: placement.backend,
        message: "the pair is placed more than once",
      });
    }
    seen.add(key);

    if (placement.why.trim() === "") {
      problems.push({
        model: placement.model,
        backend: placement.backend,
        message: "the placement gives no reason",
      });
    }
    if (!isPinnedModel(placement.model)) {
      problems.push({
        model: placement.model,
        backend: placement.backend,
        message: "the model is not pinned in @rickylabs/routing",
      });
    }
    if (placement.verdict === "runs" && placement.requires !== undefined) {
      const { env, args } = placement.requires;
      if ((env === undefined || Object.keys(env).length === 0) && (args === undefined || args.length === 0)) {
        problems.push({
          model: placement.model,
          backend: placement.backend,
          message: "an empty requirements block claims a condition it does not state",
        });
      }
    }
  }

  const placed = placedModels();
  for (const model of placed) {
    for (const backend of BACKENDS) {
      if (!seen.has(cell(model, backend))) {
        problems.push({ model, backend, message: "the model has no placement for this backend" });
      }
    }
    if (backendsFor(model).length === 0) {
      problems.push({ model, message: "the model runs nowhere, so nothing can route to it" });
    }
  }

  const owed: readonly string[] = [
    ...Object.values(LOCAL_MODEL_IDS),
    ...Object.values(OPENROUTER_MODEL_IDS),
  ];
  for (const model of owed) {
    if (!placed.includes(model)) {
      problems.push({ model, message: "routing pins this model but the matrix does not place it" });
    }
  }

  return problems;
}
