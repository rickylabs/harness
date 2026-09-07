/** These assertions are compiled by the package test script. No runtime casts confer retry authority. */
import type { DeliveryReceipt, EffectStatus, NonDeliveryProof, ReceiptEntry, SessionPending, StateStoreHandle } from "@rickylabs/harness-contracts";
import { proofFromReceipt } from "./journal.js";
import { settlePending } from "./state-store.js";
function impossibilities(unknown: Extract<EffectStatus, { status: "unknown" }>, sent: ReceiptEntry & { receipt: { delivered: true; reference: string } }, pending: SessionPending, receipt: ReceiptEntry, handle: StateStoreHandle, delivery: DeliveryReceipt): void {
  // @ts-expect-error Unknown is terminal, not a current-session pending intent.
  settlePending(unknown, receipt);
  // @ts-expect-error The store cannot accept a terminal unknown for receipt settlement.
  void handle.receipt(unknown, delivery);
  // @ts-expect-error Pending is not a terminal effect.
  const terminal: EffectStatus = pending;
  // @ts-expect-error A positive receipt cannot prove non-delivery.
  proofFromReceipt(sent);
  // @ts-expect-error A proof cannot be manufactured from an arbitrary plain object.
  const proof: NonDeliveryProof = { receiptSequence: 1, receiptDigest: "digest", reason: "guess" };
  // @ts-expect-error Unsent always requires a branded negative receipt proof.
  const unsent: EffectStatus = { ...unknown, status: "unsent" };
  void terminal; void proof; void unsent;
}
void impossibilities;
