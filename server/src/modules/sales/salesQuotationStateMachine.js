import { salesDate, salesReason } from "./salesValidation.js";
import { salesError } from "./salesErrors.js";

export function effectiveQuotationStatus(status, validUntil, currentDate) {
  if (status !== "ISSUED") return status;
  return salesDate(validUntil, "validUntil") < salesDate(currentDate, "currentDate") ? "EXPIRED" : "ISSUED";
}

export function assertQuotationEditable(status) {
  if (status !== "DRAFT") throw salesError("QUOTATION_STATE_CONFLICT");
  return true;
}

export function transitionQuotation(status, event, { validUntil, currentDate, reason } = {}) {
  if (status === "CONVERTED" && event === "CONVERT") throw salesError("QUOTATION_ALREADY_CONVERTED");
  const effective = effectiveQuotationStatus(status, validUntil, currentDate);
  if (status === "ISSUED" && effective === "EXPIRED" && event === "EXPIRE") return "EXPIRED";
  const transitions = { DRAFT: { ISSUE: "ISSUED", CANCEL: "CANCELLED" }, ISSUED: { CONVERT: "CONVERTED", CANCEL: "CANCELLED" } };
  const target = Object.hasOwn(transitions, effective) && Object.hasOwn(transitions[effective], event) ? transitions[effective][event] : null;
  if (!target) throw salesError("QUOTATION_STATE_CONFLICT");
  if (event === "CANCEL") salesReason(reason);
  return target;
}
