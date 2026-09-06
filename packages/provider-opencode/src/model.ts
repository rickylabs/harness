/**
 * `router:` and `model:` on one side, `{ providerID, modelID }` on the other.
 *
 * The whole of #55's second acceptance criterion, and it is two lines of assignment wrapped in the
 * one check that makes them safe.
 *
 * ## Why the translation is an assignment
 *
 * `@rickylabs/routing` pins opencode models **unprefixed** and says why: *"the `/swarm` wire format
 * carries the prefix in its own `router:` key … Emitting both would send the prefix twice."* The
 * vendor's prompt body wants the provider and the model as two fields. So `router` is `providerID`
 * and `model` is `modelID`, verbatim, with no table in between — a translation table here would be a
 * second spelling of every pin in a second place, which is the thing `routing`'s own header forbids.
 *
 * ## The check that is not an assignment
 *
 * Two of the pins are not unprefixed. `LOCAL_MODEL_IDS` are `n5air/qwen3.8-27b` and
 * `n5air/ling-3.0-flash`, and `routing` is explicit that there the prefix *is* part of the id. `n5air`
 * is also a router. So a dispatch naming `router: n5air` with either of those models produces
 * `{ providerID: "n5air", modelID: "n5air/qwen3.8-27b" }` — the prefix twice, which is exactly what
 * the pin was written unprefixed to avoid.
 *
 * Three things could be done about that, and only one of them is honest:
 *
 * - **Strip it.** A guess. If the local backend does want the prefixed spelling, the run silently
 *   uses a model nobody asked for, or fails with a vendor error a coordinator will read as a flake.
 * - **Send it doubled.** The same guess pointing the other way.
 * - **Refuse.** Nothing launches, the retry is safe, and the sentence says precisely which two
 *   spellings disagree and who can settle it.
 *
 * Refusing costs the two local evaluator seats on this provider until #49 can put a real
 * `opencode serve` in front of `GET /provider` and read back what its `n5air` provider actually
 * lists. That is a real cost, and it is smaller than a run that succeeds against the wrong model —
 * the house's most expensive bug shape, and the one #59 exists because of.
 */

import { ROUTERS, type DispatchRequest, TIMER_CEILING_MS, timeoutMs } from "@rickylabs/subagents";

import type { WireModel } from "./api.js";

export type Translation =
  | { readonly ok: true; readonly model: WireModel }
  | { readonly ok: false; readonly detail: string };

/** The first path segment of a model id, when there is one. */
function prefixOf(model: string): string | null {
  const slash = model.indexOf("/");
  if (slash <= 0) return null;
  return model.slice(0, slash);
}

/**
 * The `{ providerID, modelID }` a dispatch asks for, or why it cannot be built.
 *
 * `router` is required for **both** `opencode` and `opencode-run`, which is stricter than
 * `validateDispatch` — that function requires it only for `opencode`. The divergence is deliberate
 * and refuses rather than inherits: the vendor's prompt body has a mandatory `providerID` either
 * way, and the alternatives are to pick a default router here (a second place that decides routing)
 * or to send a request the server will reject with a status a coordinator reads as a flake.
 * Widening `validateDispatch` instead would ripple through the `/swarm` grammar, the board's
 * projection and the forge's snapshots, so the refusal lives here and is recorded as debt.
 */
export function translateModel(request: DispatchRequest): Translation {
  const router = request.router;
  if (router === undefined) {
    return {
      ok: false,
      detail:
        `an ${request.harness} run needs a router: the prompt body's providerID has no default, ` +
        `and this provider will not invent one (routers: ${ROUTERS.join(", ")})`,
    };
  }
  const model = request.model;
  if (model === undefined || model === "") {
    return { ok: false, detail: "the request names no model" };
  }

  const prefix = prefixOf(model);
  if (prefix !== null && (ROUTERS as readonly string[]).includes(prefix)) {
    const detail =
      prefix === router
        ? `the model id ${JSON.stringify(model)} already carries the router prefix ${JSON.stringify(
            prefix,
          )}, and the prompt body carries it separately; sending both would name the provider twice`
        : `the model id ${JSON.stringify(model)} carries the router prefix ${JSON.stringify(
            prefix,
          )} while the request routes through ${JSON.stringify(router)}`;
    return {
      ok: false,
      detail: `${detail} — which spelling the server wants is unverified, so nothing was launched`,
    };
  }

  return { ok: true, model: { providerID: router, modelID: model } };
}

/**
 * Request fields this provider cannot carry into the prompt body.
 *
 * Named rather than dropped, for the same reason `provider-claude` names its own: every entry is a
 * way the run that happens differs from the run that was ordered, and saying so at dispatch time is
 * what puts the difference into telemetry at the moment it is introduced rather than leaving it to
 * be reconstructed from a transcript afterwards.
 */
export function untranslated(request: DispatchRequest): readonly string[] {
  const lost: string[] = [];
  if (request.effort !== undefined && request.effort !== "") {
    lost.push(`effort=${request.effort} (the prompt body has no effort field)`);
  }
  if (request.maxTokens !== undefined && request.maxTokens !== "") {
    lost.push(`max-tokens=${request.maxTokens} (the server budgets the session, not this request)`);
  }
  if (request.profile !== undefined && request.profile !== "") {
    lost.push(`profile=${request.profile} (a divybot concept; set \`agent\` on the provider instead)`);
  }
  if (timeoutMs(request) === TIMER_CEILING_MS) {
    lost.push(`timeout=${request.timeout} (clamped to ${TIMER_CEILING_MS}ms, the timer ceiling)`);
  }
  return lost;
}
