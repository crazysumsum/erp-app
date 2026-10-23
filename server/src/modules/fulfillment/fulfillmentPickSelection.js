import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

function selection(rows) {
  if (!Array.isArray(rows)) throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  const amounts = new Map();
  for (const row of rows) {
    const id = fulfillmentInteger(row?.balanceId).toString();
    const quantity = fulfillmentInteger(row?.quantity);
    if (amounts.has(id)) throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
    amounts.set(id, quantity);
  }
  return amounts;
}

// Inventory owns eligibility, rank and override authorization; compare only its recommended quantities.
export function sameFulfillmentSelection(actual, recommended) {
  const selected = selection(actual);
  const expected = selection(recommended);
  return selected.size === expected.size && [...selected].every(([id, quantity]) => expected.get(id) === quantity);
}
