import { formatUnits, storedUnits } from "../ar/arCommand.js";
import { refundError } from "./refundErrors.js";

function refundUnits(amount) {
  const units = storedUnits(amount);
  if (units <= 0n) throw refundError("REFUND_INPUT_INVALID", { field: "amount" });
  return units;
}

export function confirmedRefundBalance(credit, amount) {
  const units = refundUnits(amount);
  const available = storedUnits(credit.available_amount);
  if (units > available) throw refundError("REFUND_EXCEEDS_CREDIT", { field: "amount" });
  return {
    availableAmount: formatUnits(available - units),
    refundedAmount: formatUnits(storedUnits(credit.refunded_amount) + units)
  };
}

export function voidedRefundBalance(credit, amount) {
  const units = refundUnits(amount);
  const refunded = storedUnits(credit.refunded_amount);
  if (units > refunded) throw refundError("REFUND_BALANCE_CONFLICT");
  return {
    availableAmount: formatUnits(storedUnits(credit.available_amount) + units),
    refundedAmount: formatUnits(refunded - units)
  };
}
