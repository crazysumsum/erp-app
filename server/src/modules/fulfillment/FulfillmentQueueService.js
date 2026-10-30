import { assertActorFresh } from "../authorization/directoryLookups.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { normalizeFulfillmentQueueQuery, encodeFulfillmentQueueCursor, projectFulfillmentQueueLine } from "./fulfillmentQueueQuery.js";

const placeholders = ids => ids.map(() => "?").join(",");
const sorts = { requestedDeliveryDate: ["requestedDeliveryDate", "orderDate", "salesOrderNumber", "id"], orderDate: ["orderDate", "salesOrderNumber", "id"], salesOrderNumber: ["salesOrderNumber", "id"] };
const columns = { requestedDeliveryDate: "o.requested_delivery_date", orderDate: "o.order_date", salesOrderNumber: "o.sales_order_number", id: "o.id" };
const activeWork = "EXISTS (SELECT 1 FROM fulfillments f WHERE f.sales_order_id=o.id AND f.status IN ('DRAFT','PICKING','PICKED'))";
// Same fixed owner predicates are used before pagination and in the bounded child projection.
function reservationMismatch(line, order) {
  return `r.id IS NULL OR op.id IS NULL OR reserve_root.id IS NULL OR r.sku_id<>${line}.sku_id OR r.warehouse_id<>${order}.fulfillment_warehouse_id
    OR r.purpose<>'SALE' OR op.source_module<>'SALES' OR op.source_document_type<>'SALES_ORDER'
    OR BINARY op.source_document_id<>BINARY CAST(${order}.id AS CHAR) OR BINARY op.source_line_id<>BINARY CAST(${line}.id AS CHAR)
    OR BINARY op.source_event_id<>BINARY m.source_event_id OR r.version<m.inventory_version
    OR reserve_root.source_module<>'SALES' OR reserve_root.source_document_type<>'SALES_ORDER' OR reserve_root.source_line_id<>''
    OR BINARY reserve_root.source_document_id<>BINARY CAST(${order}.id AS CHAR) OR BINARY reserve_root.source_event_id<>BINARY m.source_event_id
    OR NOT ((reserve_root.command_type='SALES_BATCH_RESERVE' AND op.command_type='SALES_LINE_RESERVE')
      OR (reserve_root.command_type='SALES_BACKORDER_BATCH_RESERVE' AND op.command_type='SALES_BACKORDER_LINE_RESERVE'))
    OR r.status<>m.status OR (r.status IN ('ACTIVE','PARTIALLY_CONSUMED') AND r.outstanding_quantity=0)
    OR (r.status IN ('CONSUMED','RELEASED','CANCELLED') AND r.outstanding_quantity<>0)
    OR (r.status='ACTIVE' AND r.consumed_quantity<>0) OR (r.status IN ('PARTIALLY_CONSUMED','CONSUMED') AND r.consumed_quantity=0)
    OR r.original_quantity<>m.original_base_quantity OR r.consumed_quantity<>m.consumed_base_quantity
    OR r.released_quantity<>m.released_base_quantity OR r.outstanding_quantity<>m.outstanding_base_quantity`;
}
export function fulfillmentQueuePageQuery(query) {
  const clauses = ["o.status IN ('CONFIRMED','PARTIALLY_FULFILLED')"], values = [];
  for (const [key, column] of [["customerId", "o.customer_id"], ["warehouseId", "o.fulfillment_warehouse_id"], ["salesOrderStatus", "o.status"], ["hasBackorder", "o.has_backorder"]]) {
    if (query[key] !== undefined) { clauses.push(`${column}=?`); values.push(query[key]); }
  }
  if (query.hasActiveWork !== undefined) clauses.push((query.hasActiveWork ? "" : "NOT ") + activeWork);
  if (query.q) {
    clauses.push("(o.sales_order_number=? OR o.customer_code_snapshot LIKE ? ESCAPE '!')");
    values.push(query.q, query.q.replace(/[!%_]/gu, value => "!" + value) + "%");
  }
  for (const [key, operator] of [["requestedDateFrom", ">="], ["requestedDateTo", "<="]]) if (query[key] !== undefined) { clauses.push(`o.requested_delivery_date ${operator} ?`); values.push(query[key]); }
  // Include both available work and corrupt facts; fully claimed Sales caches cannot conceal Inventory drift.
  clauses.push(`EXISTS (SELECT 1 FROM sales_order_lines eligible WHERE eligible.sales_order_id=o.id AND (
    eligible.reserved_outstanding_base_quantity <> COALESCE((SELECT SUM(c.active_claimed_quantity)
      FROM sales_order_line_reservations mapping JOIN fulfillment_line_reservation_claims c ON c.sales_order_line_reservation_id=mapping.id
      WHERE mapping.sales_order_line_id=eligible.id AND c.status='ACTIVE'),0)
    OR eligible.reserved_outstanding_base_quantity <> COALESCE((SELECT SUM(r.outstanding_quantity)
      FROM sales_order_line_reservations m JOIN inventory_reservations r ON r.id=m.inventory_reservation_id WHERE m.sales_order_line_id=eligible.id),0)
    OR EXISTS (SELECT 1 FROM sales_order_line_reservations m LEFT JOIN inventory_reservations r ON r.id=m.inventory_reservation_id
      LEFT JOIN inventory_operation_requests op ON op.id=r.create_operation_id LEFT JOIN inventory_operation_requests reserve_root ON reserve_root.id=m.inventory_operation_id
      WHERE m.sales_order_line_id=eligible.id AND (${reservationMismatch("eligible", "o")}))))`);
  const keys = query.q ? ["numberPriority", ...sorts[query.sortBy]] : sorts[query.sortBy];
  const selectedColumns = { ...columns, numberPriority: "(CASE WHEN o.sales_order_number=? THEN 0 ELSE 1 END)" };
  const descending = key => key !== "numberPriority" && query.descending;
  const after = query.after && { ...query.after, numberPriority: query.after.salesOrderNumber === query.q ? 0 : 1 };
  if (query.after) {
    const alternatives = [];
    for (let index = 0; index < keys.length; index++) {
      const terms = [], args = [];
      for (const prior of keys.slice(0, index)) {
        terms.push(`${selectedColumns[prior]} <=> ?`);
        if (prior === "numberPriority") args.push(query.q);
        args.push(after[prior]);
      }
      const key = keys[index], column = selectedColumns[key], value = after[key];
      if (key === "numberPriority") args.push(query.q);
      if (value === null) { if (descending(key)) continue; terms.push(`${column} IS NOT NULL`); }
      else { terms.push(descending(key) && key === "requestedDeliveryDate" ? `(${column} < ? OR ${column} IS NULL)` : `${column} ${descending(key) ? "<" : ">"} ?`); args.push(value); }
      alternatives.push("(" + terms.join(" AND ") + ")"); values.push(...args);
    }
    clauses.push("(" + alternatives.join(" OR ") + ")");
  }
  if (query.q) values.push(query.q);
  values.push(query.pageSize + 1);
  return { sql: `SELECT o.id FROM sales_orders o WHERE ${clauses.join(" AND ")} ORDER BY ${keys.map(key => selectedColumns[key] + " " + (descending(key) ? "DESC" : "ASC")).join(",")} LIMIT ?`, values };
}
export class FulfillmentQueueService {
  constructor({ database, logger }) { this.database = database; this.logger = logger; }
  async list(input = {}) {
    if (this.database.context.get()?.databaseTransaction) throw new TypeError("Queue requires a fresh read transaction");
    const query = normalizeFulfillmentQueueQuery(input), pageQuery = fulfillmentQueuePageQuery(query);
    return this.database.withTransaction(async tx => {
      const claims = this.database.context.get()?.auth?.claims, actorId = Number(claims?.sub);
      if (typeof claims?.sub !== "string" || !/^[1-9][0-9]*$/u.test(claims.sub) || !Number.isSafeInteger(actorId) || actorId < 1) throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
      const actor = await assertActorFresh(tx, { actorId, claimedRoles: claims.roles, claimedPermissions: claims.permissions });
      if (!actor.username || !actor.permissions.includes("fulfillment.view")) throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
      const [discovered] = await tx.query(pageQuery.sql, pageQuery.values), ids = discovered.slice(0, query.pageSize).map(row => String(row.id));
      if (!ids.length) return { items: [], page: query.page, pageSize: query.pageSize, hasMore: false, nextCursor: null };
      const [headers] = await tx.query(`SELECT o.id,o.sales_order_number,o.status,o.version,o.customer_id,o.customer_code_snapshot,o.customer_name_snapshot,
        o.fulfillment_warehouse_id,o.warehouse_code_snapshot,o.warehouse_name_snapshot,DATE_FORMAT(o.order_date,'%Y-%m-%d') AS order_date,DATE_FORMAT(o.requested_delivery_date,'%Y-%m-%d') AS requested_delivery_date,o.line_count,o.has_backorder,o.updated_at,${activeWork} AS has_active_work
        FROM sales_orders o WHERE o.id IN (${placeholders(ids)})`, ids);
      const [rows] = await tx.query(`SELECT l.id,l.sales_order_id,l.line_no,l.sku_id,l.sku_code_snapshot,l.sku_name_snapshot,l.ordered_base_quantity,l.reserved_outstanding_base_quantity,l.backordered_base_quantity,l.fulfilled_base_quantity,
        COALESCE(r.inventory_outstanding,0) AS inventory_outstanding,COALESCE(c.active_claimed,0) AS active_claimed,COALESCE(r.invalid_source,0) AS invalid_source
        FROM sales_order_lines l
        LEFT JOIN (SELECT m.sales_order_line_id,SUM(r.outstanding_quantity) AS inventory_outstanding,
          SUM(CASE WHEN ${reservationMismatch("owner", "so")} THEN 1 ELSE 0 END) AS invalid_source
          FROM sales_order_line_reservations m JOIN sales_order_lines owner ON owner.id=m.sales_order_line_id
          JOIN sales_orders so ON so.id=owner.sales_order_id LEFT JOIN inventory_reservations r ON r.id=m.inventory_reservation_id
          LEFT JOIN inventory_operation_requests op ON op.id=r.create_operation_id
          LEFT JOIN inventory_operation_requests reserve_root ON reserve_root.id=m.inventory_operation_id
          WHERE owner.sales_order_id IN (${placeholders(ids)}) GROUP BY m.sales_order_line_id) r ON r.sales_order_line_id=l.id
        LEFT JOIN (SELECT owner.sales_order_line_id,SUM(c.active_claimed_quantity) AS active_claimed FROM fulfillment_line_reservation_claims c
          JOIN fulfillment_lines owner ON owner.id=c.fulfillment_line_id WHERE owner.sales_order_id IN (${placeholders(ids)}) AND c.status='ACTIVE' GROUP BY owner.sales_order_line_id) c ON c.sales_order_line_id=l.id
        WHERE l.sales_order_id IN (${placeholders(ids)}) ORDER BY l.sales_order_id,l.line_no,l.id`, [...ids, ...ids, ...ids]);
      try {
        if (rows.some(row => Number(row.invalid_source) !== 0)) throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
        const lines = rows.map(row => projectFulfillmentQueueLine({ ...row, id: String(row.id), sales_order_id: String(row.sales_order_id), sku_id: String(row.sku_id), ordered_base_quantity: String(row.ordered_base_quantity), inventory_outstanding: String(row.inventory_outstanding), active_claimed: String(row.active_claimed), reserved_outstanding_base_quantity: String(row.reserved_outstanding_base_quantity), backordered_base_quantity: String(row.backordered_base_quantity), fulfilled_base_quantity: String(row.fulfilled_base_quantity) }));
        const byId = new Map(headers.map(row => [String(row.id), row]));
        const items = ids.map(id => {
          const row = byId.get(id), owned = lines.filter(line => line.salesOrderId === id);
          if (!row || owned.length !== Number(row.line_count) || owned.length > 100 || !owned.some(line => BigInt(line.fulfillableBaseQuantity) > 0n)) throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
          return { id, salesOrderNumber: row.sales_order_number, salesOrderStatus: row.status, version: Number(row.version), customerId: String(row.customer_id), customerCode: row.customer_code_snapshot, customerName: row.customer_name_snapshot,
            warehouseId: String(row.fulfillment_warehouse_id), warehouseCode: row.warehouse_code_snapshot, warehouseName: row.warehouse_name_snapshot, orderDate: row.order_date, requestedDeliveryDate: row.requested_delivery_date,
            updatedAt: Number(row.updated_at), hasBackorder: Boolean(row.has_backorder), hasActiveWork: Boolean(row.has_active_work), lines: owned };
        });
        const last = items.at(-1), hasMore = discovered.length > query.pageSize;
        return { items, page: query.page, pageSize: query.pageSize, hasMore, nextCursor: hasMore ? encodeFulfillmentQueueCursor(query, { id: last.id, salesOrderNumber: last.salesOrderNumber, orderDate: last.orderDate, requestedDeliveryDate: last.requestedDeliveryDate }) : null };
      } catch (error) {
        await this.logger?.error?.("fulfillment.queue.source_mismatch", "Fulfillment Queue source projection mismatch", { severity: "critical", code: error.code });
        throw error;
      }
    }, { isolationLevel: "REPEATABLE READ" }); // Read-only coherent snapshot; never use this advisory projection as write capacity proof.
  }
}
