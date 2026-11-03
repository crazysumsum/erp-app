import { fulfillmentError } from "./fulfillmentErrors.js";

// Callers load this evidence themselves; no command accepts caller-provided history.
export function assertShipmentConfirmationHistory(rows,{shipmentId,eventId,actorId,version}) {
 const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
 const after=Number(row?.version_after);
 if(!row||String(row.shipment_id)!==shipmentId||row.event_id!==eventId||row.action!=="CONFIRM_START"||row.from_status!=="DRAFT"||row.to_status!=="SHIPPING"||String(row.actor_user_id)!==String(actorId)||!Number.isSafeInteger(after)||after<2||after>4294967294)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
 if(after-1!==version)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
 return after;
}
