/**
 * The token budget floor, as a type rather than as a comment.
 *
 * ## The failure this exists to prevent
 *
 * A reasoning model spends tokens thinking before it spends any answering, and the two come out of
 * the same budget. Ask one for an answer in ten tokens and it does not refuse: it reasons for
 * seventy-one, hits the ceiling mid-thought, and returns HTTP 200 with an empty content string and
 * a perfectly ordinary finish reason. Nothing anywhere reports an error. The caller sees a model
 * that answered with nothing, concludes the model is broken or the prompt was bad, and starts
 * debugging the wrong half of the system.
 *
 * That is the worst shape a bug can have — a success-coded failure — and it is entirely
 * preventable, because the budget is known before the request is sent.
 *
 * ## Why the floor applies to every request
 *
 * The obvious scoping would be "reasoning models only". That requires a registry of which models
 * reason, and such a registry is a time-sliding fact: a vendor turns reasoning on in a point
 * release, the table still says no, and the floor stops applying to exactly the model that needed
 * it. The epic's own rule is that facts which change while you read them do not get committed.
 *
 * So the floor is unconditional, and the cost of that is nil: a request under 300 tokens is not a
 * request anyone makes on purpose. A classification returning one word still needs headroom for
 * the wrapper the model puts around it, and a caller who genuinely wants a ten-token completion
 * wants a different model, not a smaller ceiling.
 *
 * ## Branded, not validated at the edges
 *
 * `ReasoningBudget` is a branded number, so it cannot be produced by arithmetic or by reading a
 * config value — only by `reasoningBudget`, which is the sole place the floor is applied. A
 * function that takes a `ReasoningBudget` therefore cannot be handed an unchecked one, and the
 * check cannot be forgotten at a new call site because there is no way to spell the type without
 * going through the constructor. Compare a plain `number` parameter with a check inside: that
 * moves the guarantee into every implementation, where it holds only as long as everyone
 * remembers. Acceptance criterion 4 asks for `max_tokens < 300` to be unrepresentable; this is
 * what unrepresentable means in a structural type system.
 *
 * Like everything else in this package the constructor returns a verdict rather than throwing.
 * Refusing a budget is an ordinary outcome of asking, and a caller deciding what to do about it is
 * not exception handling.
 */

/**
 * The smallest budget any request may carry.
 *
 * Not a tuned figure — it is a floor with headroom, chosen so that the observed failure (71
 * reasoning tokens consuming a 10-token budget in full) sits far enough below it that the margin
 * survives a model that thinks harder. Raising it is safe; lowering it needs evidence.
 */
export const MIN_REASONING_BUDGET = 300;

/**
 * A token budget that has been through `reasoningBudget`.
 *
 * The brand is a phantom property: it exists only in the type, so a `ReasoningBudget` is an
 * ordinary number at runtime and can be handed straight to a request body. Nothing constructs the
 * property, and the name is spelled so that writing it by hand reads as the mistake it is.
 */
export type ReasoningBudget = number & { readonly __reasoningBudgetBrand: "checked" };

/** Why a proposed budget was refused. */
export const BUDGET_REFUSALS = ["below-floor", "not-an-integer", "not-finite"] as const;
export type BudgetRefusal = (typeof BUDGET_REFUSALS)[number];

/** The answer to "may I send a request with this ceiling". */
export type BudgetVerdict =
  | { readonly ok: true; readonly budget: ReasoningBudget }
  | { readonly ok: false; readonly reason: BudgetRefusal; readonly message: string };

/**
 * Accept a token ceiling, or say why not.
 *
 * The non-integer and non-finite cases are here because the argument usually arrives from a profile
 * or a lane request rather than from a literal, and `NaN` reaches a request body as `null` — which
 * some servers read as "no limit". A budget that silently becomes unlimited is a spend incident,
 * so it is refused at the same door as one that is too small.
 */
export function reasoningBudget(maxTokens: number): BudgetVerdict {
  if (!Number.isFinite(maxTokens)) {
    return {
      ok: false,
      reason: "not-finite",
      message: `a token budget must be a finite number, got ${String(maxTokens)}`,
    };
  }
  if (!Number.isInteger(maxTokens)) {
    return {
      ok: false,
      reason: "not-an-integer",
      message: `a token budget must be a whole number of tokens, got ${String(maxTokens)}`,
    };
  }
  if (maxTokens < MIN_REASONING_BUDGET) {
    return {
      ok: false,
      reason: "below-floor",
      message:
        `${String(maxTokens)} is below the ${String(MIN_REASONING_BUDGET)}-token floor. A model that ` +
        "reasons before answering can spend the whole budget thinking and return an empty completion " +
        "with a success status, so a ceiling this low fails without reporting a failure.",
    };
  }
  return { ok: true, budget: maxTokens as ReasoningBudget };
}

/**
 * Whether a number would be accepted, without building the verdict.
 *
 * For callers that only need to filter — a profile validator listing every bad field, say. Anything
 * that is going to *send* the request should call `reasoningBudget` instead and carry the branded
 * value, so the check and the use cannot drift apart.
 */
export function isReasoningBudget(maxTokens: number): maxTokens is ReasoningBudget {
  return reasoningBudget(maxTokens).ok;
}

/**
 * The nearest acceptable budget at or above a proposal.
 *
 * Deliberately not the fallback path for a refusal: raising a caller's ceiling silently is how a
 * spend limit becomes advisory. It exists for the one honest use, which is a caller that wants the
 * floor itself without spelling the constant — `clampToFloor(0)` is the smallest legal request.
 */
export function clampToFloor(maxTokens: number): ReasoningBudget {
  if (!Number.isFinite(maxTokens) || !Number.isInteger(maxTokens) || maxTokens < MIN_REASONING_BUDGET) {
    return MIN_REASONING_BUDGET as ReasoningBudget;
  }
  return maxTokens as ReasoningBudget;
}
