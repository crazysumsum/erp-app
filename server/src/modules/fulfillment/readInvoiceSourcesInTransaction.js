import { lockFulfillmentRowsInTransaction, sortedFulfillmentIds } from "./FulfillmentLockService.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

const maxShipments = 20;
const maxLinesPerShipment = 100;
const placeholders = values => values.map(() => "?").join(",");
const stringId = value => String(value);
const conflict = () => fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
const unavailable = () => fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = stringId(row[key]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return groups;
}

function exactMoney(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,14})\.[0-9]{4}$/u.test(value)) throw unavailable();
  return value;
}

async function readOrderLines(tx, salesLineIds) {
  // After shipment these specific order fields are immutable: editing requires
  // DRAFT and Sales withdrawal rejects orders with any Fulfillment history.
  const [rows] = await tx.query(
    `SELECT l.id, l.sales_order_id, l.sku_id, l.uom_code_snapshot, l.to_base_factor_snapshot,
      CAST(l.ordered_base_quantity AS CHAR) AS ordered_base_quantity,
      CAST(l.unit_selling_price AS CHAR) AS unit_selling_price, CAST(l.line_amount AS CHAR) AS line_amount,
      o.status AS order_status, o.customer_id, o.currency_code, o.payment_term_id,
      o.payment_term_code_snapshot, o.payment_term_name_snapshot
     FROM sales_order_lines l JOIN sales_orders o ON o.id = l.sales_order_id
     WHERE l.id IN (${placeholders(salesLineIds)})`,
    salesLineIds
  );
  if (rows.length !== salesLineIds.length) throw unavailable();
  return new Map(rows.map(row => [stringId(row.id), row]));
}

async function readShipmentSequence(tx, salesLineIds) {
  // Sales appends FULFILLMENT_CONFIRM under its SO root lock in the same commit
  // that publishes SHIPPED. Neither a Draft ID nor a wall clock orders shipments.
  const [rows] = await tx.query(
    `SELECT l.id, l.shipment_id, l.sales_order_line_id, s.sales_order_id, s.customer_id,
      s.status, s.confirmation_event_id, h.sequence_no,
      CAST(l.shipped_base_quantity AS CHAR) AS shipped_base_quantity,
      CAST(l.reversed_base_quantity AS CHAR) AS reversed_base_quantity
     FROM shipment_lines l
     JOIN shipments s ON s.id = l.shipment_id
     LEFT JOIN sales_order_status_history h ON h.sales_order_id = s.sales_order_id
       AND h.event_id = s.confirmation_event_id AND h.action = 'FULFILLMENT_CONFIRM'
     WHERE l.sales_order_line_id IN (${placeholders(salesLineIds)})
       AND s.status IN ('SHIPPED', 'REVERSING', 'REVERSED')
     ORDER BY l.sales_order_line_id, h.sequence_no, l.id`,
    salesLineIds
  );
  return groupBy(rows, "sales_order_line_id");
}

function sequenceNumber(row) {
  const number = Number(row.sequence_no);
  if (!row.confirmation_event_id || !Number.isSafeInteger(number) || number < 1) throw unavailable();
  return number;
}

function projectLine(line, shipment, orderLine, history) {
  if (stringId(orderLine.sales_order_id) !== stringId(shipment.sales_order_id) ||
      stringId(orderLine.customer_id) !== stringId(shipment.customer_id) ||
      stringId(orderLine.sku_id) !== stringId(line.sku_id) ||
      stringId(line.fulfillment_id) !== stringId(shipment.fulfillment_id)) throw conflict();
  if (orderLine.order_status === "DRAFT") throw unavailable();

  const id = stringId(line.id);
  const source = history.find(row => stringId(row.id) === id);
  const quantity = stringId(line.shipped_base_quantity);
  const reversed = stringId(line.reversed_base_quantity);
  if (!source || source.status !== "SHIPPED" || source.shipped_base_quantity !== quantity ||
      source.reversed_base_quantity !== reversed || source.confirmation_event_id !== shipment.confirmation_event_id) throw unavailable();
  const confirmationSequence = sequenceNumber(source);
  const ordered = fulfillmentInteger(orderLine.ordered_base_quantity);
  const shipped = fulfillmentInteger(quantity, { positive: false });
  if (reversed !== "0" || shipped > ordered) throw conflict();

  let total = shipped;
  const priorShipments = [];
  for (const row of history) {
    if (stringId(row.sales_order_id) !== stringId(shipment.sales_order_id) ||
        stringId(row.customer_id) !== stringId(shipment.customer_id)) throw conflict();
    const sequence = sequenceNumber(row);
    if (sequence > confirmationSequence) continue;
    if (sequence === confirmationSequence) {
      if (stringId(row.id) !== id) throw conflict();
      continue;
    }
    if (row.status !== "SHIPPED" || row.reversed_base_quantity !== "0") throw unavailable();
    total += fulfillmentInteger(row.shipped_base_quantity, { positive: false });
    priorShipments.push({
      shipmentId: stringId(row.shipment_id),
      shipmentLineId: stringId(row.id),
      confirmationEventId: row.confirmation_event_id,
      confirmationSequence: sequence,
      shippedBaseQuantity: row.shipped_base_quantity
    });
  }
  if (total > ordered) throw conflict();

  return {
    id, lineNo: Number(line.line_no),
    salesOrderLineId: stringId(line.sales_order_line_id),
    skuId: stringId(line.sku_id),
    skuCodeSnapshot: line.sku_code_snapshot,
    skuNameSnapshot: line.sku_name_snapshot,
    baseUomCodeSnapshot: line.base_uom_code_snapshot,
    salesUomCodeSnapshot: orderLine.uom_code_snapshot,
    toBaseFactor: Number(orderLine.to_base_factor_snapshot),
    shippedBaseQuantity: quantity,
    reversedBaseQuantity: reversed,
    orderedBaseQuantity: orderLine.ordered_base_quantity,
    unitSellingPrice: exactMoney(orderLine.unit_selling_price),
    lineAmount: exactMoney(orderLine.line_amount),
    confirmationSequence,
    priorShipments
  };
}

/**
 * Internal AR source read. Uses the caller's active RC transaction. The caller
 * owns authorization, duplicate-invoice protection, money allocation and COMMIT.
 * Result order is by shipment ID, then by business line number.
 */
export async function readInvoiceSourcesInTransaction(tx, input) {
  if (tx?.context?.get()?.databaseTransaction !== tx || getActiveTransactionIsolation(tx) !== "READ COMMITTED") {
    throw new TypeError("Invoice shipment sources require the active READ COMMITTED transaction");
  }
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Reflect.ownKeys(input).length !== 1 || !Array.isArray(input.shipmentIds) ||
      input.shipmentIds.length < 1 || input.shipmentIds.length > maxShipments ||
      input.shipmentIds.some(id => typeof id !== "string")) throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  const ids = sortedFulfillmentIds(input.shipmentIds);
  if (ids.length !== input.shipmentIds.length) throw fulfillmentError("FULFILLMENT_INPUT_INVALID");

  const shipments = await lockFulfillmentRowsInTransaction(tx, "shipments", ids);
  if (shipments.some(row => row.status !== "SHIPPED")) throw fulfillmentError("SHIPMENT_STATE_CONFLICT");
  const [lineIds] = await tx.query(
    `SELECT id FROM shipment_lines WHERE shipment_id IN (${placeholders(ids)}) LIMIT ?`,
    [...ids, ids.length * maxLinesPerShipment + 1]
  );
  if (!lineIds.length || lineIds.length > ids.length * maxLinesPerShipment) throw unavailable();
  const lines = await lockFulfillmentRowsInTransaction(tx, "shipment_lines", lineIds.map(row => stringId(row.id)));
  const linesByShipment = groupBy(lines, "shipment_id");
  const salesLineIds = sortedFulfillmentIds(lines.map(row => stringId(row.sales_order_line_id)));
  const orderLines = await readOrderLines(tx, salesLineIds);
  const shipmentSequence = await readShipmentSequence(tx, salesLineIds);

  const result = shipments.map(shipment => {
    const shipmentId = stringId(shipment.id);
    const members = linesByShipment.get(shipmentId) ?? [];
    if (!members.length || members.length > maxLinesPerShipment || members.length !== Number(shipment.line_count)) throw unavailable();
    const order = orderLines.get(stringId(members[0].sales_order_line_id));
    const projected = members.map(line => {
      const sourceId = stringId(line.sales_order_line_id);
      return projectLine(line, shipment, orderLines.get(sourceId), shipmentSequence.get(sourceId) ?? []);
    }).sort((a, b) => a.lineNo - b.lineNo);
    if (projected.some(line => line.confirmationSequence !== projected[0].confirmationSequence) ||
        !projected.some(line => line.shippedBaseQuantity !== "0")) throw unavailable();

    return {
      id: shipmentId,
      shipmentNumber: shipment.shipment_number,
      confirmationEventId: shipment.confirmation_event_id,
      salesOrderId: stringId(shipment.sales_order_id),
      customerId: stringId(shipment.customer_id),
      customerCodeSnapshot: shipment.customer_code_snapshot,
      customerNameSnapshot: shipment.customer_name_snapshot,
      status: shipment.status,
      version: Number(shipment.version),
      currencyCode: order.currency_code,
      paymentTerm: order.payment_term_id === null ? null : {
        id: stringId(order.payment_term_id),
        code: order.payment_term_code_snapshot,
        name: order.payment_term_name_snapshot
      },
      lines: projected
    };
  });
  if (result.some(row => row.customerId !== result[0].customerId || row.currencyCode !== result[0].currencyCode)) throw conflict();
  return result;
}
