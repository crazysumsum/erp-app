import { fulfillmentError } from "./fulfillmentErrors.js";

export function normalizeShipmentWeight(totalWeight, weightUom) {
  const invalid = () => { throw fulfillmentError("FULFILLMENT_INPUT_INVALID"); };
  if (totalWeight === null) {
    if (weightUom !== "") invalid();
    return Object.freeze({ totalWeight: null, weightUom: "" });
  }
  // Validate precision before trimming: overprecision must never be rounded away.
  if (typeof totalWeight !== "string" || !/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/u.test(totalWeight) ||
      !/[1-9]/u.test(totalWeight) || !["KG", "G"].includes(weightUom)) invalid();
  const canonical = totalWeight.includes(".") ? totalWeight.replace(/0+$/u, "").replace(/\.$/u, "") : totalWeight;
  return Object.freeze({ totalWeight: canonical, weightUom });
}
