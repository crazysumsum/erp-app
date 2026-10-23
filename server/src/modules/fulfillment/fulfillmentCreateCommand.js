import { fulfillmentError } from "./fulfillmentErrors.js";
const invalid = () => { throw fulfillmentError("FULFILLMENT_INPUT_INVALID"); };
const id = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, required, optional = []) => value && Object.getPrototypeOf(value) === Object.prototype && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
export function normalizeFulfillmentCreate(body) {
  if (!exact(body, ["eventId", "salesOrderId", "salesOrderVersion", "lines"], ["notes"]) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(body.eventId) || typeof body.eventId !== "string" || !id(body.salesOrderId) || !id(body.salesOrderVersion) || body.salesOrderVersion > 4294967295 || !Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100 || body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 2000)) invalid();
  const seen = new Set();
  const lines = body.lines.map(line => {
    if (!exact(line, ["salesOrderLineId", "plannedBaseQuantity"]) || !id(line.salesOrderLineId) || seen.has(line.salesOrderLineId) || typeof line.plannedBaseQuantity !== "string" || !/^[1-9][0-9]{0,15}$/u.test(line.plannedBaseQuantity) || BigInt(line.plannedBaseQuantity) > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
    seen.add(line.salesOrderLineId); return Object.freeze({ ...line });
  }).sort((a,b) => a.salesOrderLineId - b.salesOrderLineId);
  return Object.freeze({ eventId: body.eventId, salesOrderId: body.salesOrderId, salesOrderVersion: body.salesOrderVersion, lines: Object.freeze(lines), notes: body.notes ?? "" });
}
