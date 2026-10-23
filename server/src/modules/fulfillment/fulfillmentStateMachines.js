import { fulfillmentError } from "./fulfillmentErrors.js";

const FULFILLMENT = {
  DRAFT: ["PICKING", "CANCELLED"], PICKING: ["PICKED", "CANCELLED"],
  PICKED: ["SHIPPED", "CANCELLED"], SHIPPED: ["REVERSED"], CANCELLED: [], REVERSED: []
};
const SHIPMENT = {
  DRAFT: ["SHIPPING", "CANCELLED"], SHIPPING: ["SHIPPED", "DRAFT"],
  SHIPPED: ["REVERSING"], REVERSING: ["REVERSED", "SHIPPED"], CANCELLED: [], REVERSED: []
};
const REVERSAL = { REVERSING: ["REVERSED", "FAILED"], REVERSED: [], FAILED: [] };

function transition(graph, from, to, code) {
  if (!Object.hasOwn(graph, from) || !graph[from].includes(to)) throw fulfillmentError(code);
  return true;
}

export const assertFulfillmentTransition = (from, to) => transition(FULFILLMENT, from, to, "FULFILLMENT_STATE_CONFLICT");
export const assertShipmentTransition = (from, to) => transition(SHIPMENT, from, to, "SHIPMENT_STATE_CONFLICT");
export const assertReversalTransition = (from, to) => transition(REVERSAL, from, to, "SHIPMENT_STATE_CONFLICT");
