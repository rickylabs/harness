import {
  problem, type ReceiptResult, type ReceiptVerdict, SCOPE, validateReceipt, verdictOf,
} from "../domain/receipts/route-receipt.ts";
import type { DuplicateKeyCheck } from "../ports/duplicate-keys.ts";

export interface IndexedReceiptResult extends ReceiptResult {
  readonly index: number;
}
export interface ReceiptReport {
  readonly scope: typeof SCOPE;
  readonly verdict: ReceiptVerdict;
  readonly results: readonly IndexedReceiptResult[];
  readonly reason?: "no-inputs";
}

/** JSON syntax first; the duplicate-key check then refuses semantically repeated keys. */
export function validateReceiptText(input: string, duplicateKeys: DuplicateKeyCheck): ReceiptResult {
  let receipt: unknown;
  try { receipt = JSON.parse(input); }
  catch { return problem("fail", "invalid-json"); }
  const keys = duplicateKeys(input);
  if (keys !== "ok") return problem("fail", keys);
  return validateReceipt(receipt);
}

/**
 * Explicit inputs only. `read` returns the text, or throws when the input cannot be read; diagnostics
 * expose an input index, never paths, values or parser errors. No input at all is unproven.
 */
export async function checkReceipts(
  inputs: readonly string[],
  read: (input: string) => Promise<string>,
  duplicateKeys: DuplicateKeyCheck,
): Promise<ReceiptReport> {
  const results: IndexedReceiptResult[] = [];
  for (const [index, input] of inputs.entries()) {
    let result: ReceiptResult;
    try { result = validateReceiptText(await read(input), duplicateKeys); }
    catch { result = problem("unproven", "unreadable"); }
    results.push({ index, ...result });
  }
  const verdict = results.length === 0 ? "unproven" : verdictOf(results);
  return { scope: SCOPE, verdict, results, ...(inputs.length ? {} : { reason: "no-inputs" as const }) };
}
