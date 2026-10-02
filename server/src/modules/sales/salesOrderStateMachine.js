import { assertBaseQuantity } from "./salesQuantityMath.js";
import { salesReason } from "./salesValidation.js";
import { salesError } from "./salesErrors.js";

const transitions = {
  DRAFT: { CONFIRM_START: "CONFIRMING", CANCEL: "CANCELLED" },
  CONFIRMING: { CONFIRM_SUCCEEDED: "CONFIRMED", CONFIRM_FAILED: "DRAFT" },
  CONFIRMED: { WITHDRAW: "DRAFT", CANCEL: "CANCELLED", FULFILL: "PARTIALLY_FULFILLED" },
  PARTIALLY_FULFILLED: { FULFILL: "COMPLETED", CLOSE_REMAINING: "CLOSED", REVERSE_SHIPMENT: "CONFIRMED" },
  COMPLETED: { REVERSE_SHIPMENT: "CONFIRMED" },
  CLOSED: { REVERSE_SHIPMENT: "CONFIRMED" }
};

export function transitionSalesOrder(status, event, context = {}) {
  let target = Object.hasOwn(transitions, status) && Object.hasOwn(transitions[status], event) ? transitions[status][event] : null;
  if (!target || context.archived) throw salesError("SALES_STATE_CONFLICT");
  if (["CANCEL", "WITHDRAW", "CLOSE_REMAINING"].includes(event)) salesReason(context.reason);
  if (status === "CONFIRMED" && ["CANCEL", "WITHDRAW"].includes(event) && assertBaseQuantity(context.fulfilledBaseQuantity) !== 0n) throw salesError("ORDER_ALREADY_FULFILLED");
  if (["FULFILL", "REVERSE_SHIPMENT", "CLOSE_REMAINING"].includes(event)) {
    const fulfilled = assertBaseQuantity(context.fulfilledBaseQuantity);
    const ordered = assertBaseQuantity(context.orderedBaseQuantity);
    if (ordered === 0n || fulfilled > ordered) throw salesError("SALES_QUANTITY_INVALID");
    if (event === "FULFILL") {
      if (fulfilled === 0n) throw salesError("SALES_STATE_CONFLICT");
      target = fulfilled === ordered ? "COMPLETED" : "PARTIALLY_FULFILLED";
    } else if (event === "REVERSE_SHIPMENT") {
      if (context.hasIrreversibleDownstream || fulfilled === ordered) throw salesError("SALES_STATE_CONFLICT");
      target = fulfilled === 0n ? "CONFIRMED" : "PARTIALLY_FULFILLED";
    } else if (fulfilled === 0n || fulfilled === ordered) throw salesError("SALES_STATE_CONFLICT");
  }
  return target;
}
