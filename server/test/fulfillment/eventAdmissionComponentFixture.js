import { hasTransactionEventAdmission } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { assertShipmentEventAdmissionInTransaction } from "../../src/modules/fulfillment/shipmentEventAdmission.js";
import { fulfillmentError } from "../../src/modules/fulfillment/fulfillmentErrors.js";

// A fixture-declared upstream double for existing provider/component tests only.
// Genuine Recovery tests and the private L1 never use this helper.
export function componentReversalAdmission(database, events) {
  return async (tx, input) => {
    const expected = events.get(input.eventId);
    if (!expected) return assertShipmentEventAdmissionInTransaction(database, tx, input);
    if (!hasTransactionEventAdmission(database, tx, input.eventId) ||
        String(database.context.get()?.auth?.claims?.sub) !== expected.actorId ||
        input.shipmentId !== expected.shipmentId ||
        input.action !== undefined && !["REVERSE", "SHIPMENT_REVERSE"].includes(input.action)) {
      throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    }
    return Object.freeze({ state: "MANAGED", eventId: input.eventId, ...expected });
  };
}
