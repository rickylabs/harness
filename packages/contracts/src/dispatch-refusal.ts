/**
 * A refused dispatch outcome, decoded strictly (0.38.0). The governance read document never carries the
 * refusal's detail or approval; a producer that compares them privately decodes them here, so the shape
 * keeps one owner.
 */
import type { DispatchOutcome } from "./routes.js";
import { invalid, parsePending, PROSE_CAP, record, text, timestamp } from "./governance-read-fields.js";

/** Decode `{ accepted: false, reason, detail, approval? }` into owned data. An approval must be requested
 * no later than `observedAt`. Null on any failure, including hostile reflection. */
export function readDispatchRefusal(value: unknown, observedAt: string): Extract<DispatchOutcome, { readonly accepted: false }> | null {
  try {
    const upper = timestamp(observedAt, "observedAt").ms;
    const hasApproval = typeof value === "object" && value !== null && Object.hasOwn(value, "approval");
    const input = record(value, "outcome", ["accepted", "reason", "detail", ...(hasApproval ? ["approval"] : [])]);
    if (input.accepted !== false) invalid("outcome.accepted", "must be false");
    const reason = text(input.reason, "outcome.reason", PROSE_CAP);
    const detail = text(input.detail, "outcome.detail", PROSE_CAP);
    return hasApproval
      ? { accepted: false, reason, detail, approval: parsePending(input.approval, "outcome.approval", upper) }
      : { accepted: false, reason, detail };
  } catch {
    return null;
  }
}
