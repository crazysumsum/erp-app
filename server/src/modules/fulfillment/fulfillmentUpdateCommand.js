import { fulfillmentError } from "./fulfillmentErrors.js";
import { normalizeFulfillmentDraftLines } from "./fulfillmentCreateCommand.js";
export function normalizeFulfillmentUpdate(body) {
  if(!body||Object.getPrototypeOf(body)!==Object.prototype||["eventId","version","lines"].some(key=>!Object.hasOwn(body,key))||Object.keys(body).some(key=>!["eventId","version","lines","notes"].includes(key))||typeof body.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId)||!Number.isSafeInteger(body.version)||body.version<1||body.version>4294967295||body.notes!==undefined&&(typeof body.notes!=="string"||body.notes.length>2000))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  return Object.freeze({eventId:body.eventId,version:body.version,lines:normalizeFulfillmentDraftLines(body.lines),...(body.notes===undefined?{}:{notes:body.notes})});
}
