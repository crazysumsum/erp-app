import { createHash } from "node:crypto";

// Version 1 column order is the persisted Archive hashing contract. Extend with a new version after release.
const c = (type, nullable = false, defaultValue = null, generated = null) => ({ type, nullable, defaultValue, generated });
const id = () => c("bigint unsigned");
const actor = () => c("bigint unsigned", true);
const text = (size, empty = false) => c(`varchar(${size})`, false, empty ? "" : null);
const ascii = (size, nullable = false, empty = false) => ({ ...c(`varchar(${size})`, nullable, empty ? "" : null), collation: "ascii_bin" });
const uuid = (nullable = false) => ({ ...c("char(36)", nullable), collation: "ascii_bin" });
const version = () => c("int unsigned", false, "1");
const stamp = (nullable = false) => c("bigint unsigned", nullable);
const times = () => ({ created_at: stamp(), updated_at: stamp() });
const historyColumns = owner => ({ id: id(), [owner]: id(), sequence_no: c("int unsigned"),
  from_status: ascii(20, true), to_status: ascii(20), action: ascii(50), reason: text(500, true), event_id: uuid(),
  version_after: c("int unsigned"), actor_user_id: actor(), actor_label: text(190), occurred_at: stamp() });

export const FULFILLMENT_ARCHIVE_CONTRACTS = [
  { table: "fulfillments", columns: {
    id: id(), fulfillment_number: ascii(24), sales_order_id: id(), sales_order_number_snapshot: ascii(20),
    customer_id: id(), customer_code_snapshot: text(100), customer_name_snapshot: text(190), warehouse_id: id(),
    warehouse_code_snapshot: text(100), warehouse_name_snapshot: text(190), status: ascii(20), line_count: c("smallint unsigned"),
    has_short_pick: c("tinyint(1)", false, "0"), active_shipment_id: actor(), version: version(),
    allocated_at: stamp(true), picked_at: stamp(true), shipped_at: stamp(true), cancelled_at: stamp(true), reversed_at: stamp(true),
    picked_by: actor(), shipped_by: actor(), cancelled_by: actor(), reversed_by: actor(),
    cancel_reason: text(500, true), notes: text(2000, true), last_business_updated_at: stamp(), ...times(), created_by: actor(), updated_by: actor()
  } },
  { table: "fulfillment_lines", columns: {
    id: id(), fulfillment_id: id(), sales_order_id: id(), sales_order_line_id: id(), line_no: c("smallint unsigned"),
    sales_order_line_no: c("smallint unsigned"), sku_id: id(), sku_code_snapshot: text(190), sku_name_snapshot: text(190),
    base_uom_id: id(), base_uom_code_snapshot: text(100), base_uom_name_snapshot: text(100), tracking_policy_snapshot: ascii(30),
    minimum_sale_life_days_snapshot: c("int unsigned", false, "0"), planned_base_quantity: id(),
    allocated_base_quantity: c("bigint unsigned", false, "0"), picked_base_quantity: c("bigint unsigned", false, "0"),
    short_base_quantity: c("bigint unsigned", false, "0"), shipped_base_quantity: c("bigint unsigned", false, "0"),
    reversed_base_quantity: c("bigint unsigned", false, "0"), short_pick_reason: text(500, true), version: version(), ...times()
  } },
  { table: "fulfillment_line_reservation_claims", columns: {
    id: id(), fulfillment_id: id(), fulfillment_line_id: id(), sales_order_line_reservation_id: id(), inventory_reservation_id: id(),
    original_claimed_quantity: id(), active_claimed_quantity: id(), released_quantity: c("bigint unsigned", false, "0"),
    consumed_quantity: c("bigint unsigned", false, "0"), reversed_quantity: c("bigint unsigned", false, "0"),
    status: ascii(20), inventory_version: c("int unsigned"), ...times()
  } },
  { table: "fulfillment_allocations", columns: {
    id: id(), fulfillment_id: id(), fulfillment_line_id: id(), claim_id: id(), inventory_reservation_id: id(),
    inventory_allocation_id: id(), inventory_balance_id: id(), warehouse_id: id(), bin_id: id(), lot_id: actor(),
    bin_code_snapshot: text(100, true), lot_number_snapshot: text(100, true), expiry_date_snapshot: c("date", true),
    stock_status_snapshot: ascii(20), selection_strategy: ascii(20), recommended_rank_snapshot: c("int unsigned"),
    is_sequence_override: c("tinyint(1)", false, "0"), override_reason: text(500, true), recommended_summary: c("json", true),
    allocated_base_quantity: id(), picked_base_quantity: c("bigint unsigned", false, "0"),
    released_base_quantity: c("bigint unsigned", false, "0"), status: ascii(30),
    inventory_version: c("int unsigned"), balance_version: c("int unsigned"), ...times()
  } },
  { table: "fulfillment_status_history", columns: historyColumns("fulfillment_id") },
  { table: "shipments", columns: {
    id: id(), shipment_number: ascii(24), fulfillment_id: id(), sales_order_id: id(), customer_id: id(), warehouse_id: id(),
    status: { ...ascii(20), defaultValue: "DRAFT" },
    effective_fulfillment_id: c("bigint unsigned", true, null, "IF(status='CANCELLED',NULL,fulfillment_id)"),
    shipping_address_id: id(), shipping_address_version: c("int unsigned"), shipping_contact_id: actor(), shipping_contact_version: c("int unsigned", true),
    customer_code_snapshot: text(100, true), customer_name_snapshot: text(190, true), address_name_snapshot: text(190, true),
    recipient_company_snapshot: text(190, true), recipient_name_snapshot: text(190, true), address_line1_snapshot: text(255, true),
    address_line2_snapshot: text(255, true), address_line3_snapshot: text(255, true), city_snapshot: text(190, true), region_snapshot: text(190, true),
    postal_code_snapshot: text(40, true), country_code_snapshot: c("char(2)", false, ""), contact_name_snapshot: text(190, true),
    contact_phone_snapshot: text(100, true), contact_email_snapshot: text(254, true), carrier_name: text(190, true), tracking_number: text(190, true),
    package_count: c("int unsigned", true), total_weight: c("decimal(20,6)", true), weight_uom: ascii(20, false, true), notes: text(2000, true),
    line_count: c("smallint unsigned"), shipment_date: c("date", true), confirmation_event_id: uuid(true), reversal_event_id: uuid(true),
    correlation_id: uuid(true), version: version(), shipped_at: stamp(true), cancelled_at: stamp(true), reversed_at: stamp(true),
    shipped_by: actor(), cancelled_by: actor(), reversed_by: actor(), cancel_reason: text(500, true), last_business_updated_at: stamp(),
    ...times(), created_by: actor(), updated_by: actor()
  } },
  { table: "shipment_lines", columns: {
    id: id(), shipment_id: id(), fulfillment_id: id(), fulfillment_line_id: id(), line_no: c("smallint unsigned"),
    sales_order_line_id: id(), sku_id: id(), base_uom_id: id(), sku_code_snapshot: text(190), sku_name_snapshot: text(190),
    base_uom_code_snapshot: text(100), shipped_base_quantity: id(), reversed_base_quantity: c("bigint unsigned", false, "0"), ...times()
  } },
  { table: "shipment_issue_details", columns: {
    id: id(), shipment_id: id(), shipment_line_id: id(), fulfillment_allocation_id: id(), inventory_operation_id: id(),
    inventory_movement_id: id(), inventory_reservation_id: id(), inventory_allocation_id: id(), inventory_balance_id: id(),
    warehouse_id: id(), bin_id: id(), lot_id: actor(), warehouse_code_snapshot: text(100, true), bin_code_snapshot: text(100, true),
    lot_number_snapshot: text(100, true), expiry_date_snapshot: c("date", true), stock_status_snapshot: ascii(20),
    sku_code_snapshot: text(190), base_uom_code_snapshot: text(100), issued_base_quantity: id(), reversal_movement_id: actor(), created_at: stamp()
  } },
  { table: "shipment_status_history", columns: historyColumns("shipment_id") },
  { table: "shipment_reversals", columns: {
    id: id(), reversal_number: ascii(24), shipment_id: id(),
    effective_shipment_id: c("bigint unsigned", true, null, "IF(status IN ('REVERSING','REVERSED'),shipment_id,NULL)"),
    status: ascii(20), event_id: uuid(), correlation_id: uuid(), reason: text(500), goods_under_company_control: c("tinyint(1)"),
    goods_returned_to_original_bins: c("tinyint(1)"), failure_code: ascii(80, false, true), before_summary: c("json", true),
    after_summary: c("json", true), version: version(), created_at: stamp(), completed_at: stamp(true), created_by: actor(), completed_by: actor()
  } },
  { table: "shipment_reversal_details", columns: {
    id: id(), reversal_id: id(), shipment_id: id(), shipment_issue_detail_id: id(), inventory_reversal_operation_id: id(),
    inventory_reversal_movement_id: id(), inventory_reservation_id: id(), warehouse_id: id(), bin_id: id(), lot_id: actor(),
    stock_status_snapshot: ascii(20), reversed_base_quantity: id(), reservation_before_summary: c("json"), reservation_after_summary: c("json"), created_at: stamp()
  } },
  { table: "fulfillment_audit_logs", columns: {
    id: id(), target_type: ascii(30), target_id: id(), action: ascii(60), event_id: uuid(true), correlation_id: uuid(),
    actor_user_id: actor(), actor_label: text(190), before_summary: c("json", true), after_summary: c("json", true), details: c("json", true),
    ip_address: ascii(45, false, true), is_archived: c("tinyint(1)", false, "0"), occurred_at: stamp()
  } }
];
for (const contract of FULFILLMENT_ARCHIVE_CONTRACTS) {
  for (const column of Object.values(contract.columns)) Object.freeze(column);
  Object.freeze(contract.columns); Object.freeze(contract);
}
Object.freeze(FULFILLMENT_ARCHIVE_CONTRACTS);
const contracts = new Map(FULFILLMENT_ARCHIVE_CONTRACTS.map(contract => [contract.table, contract]));
const metadata = new Set(["archive_batch_id", "archived_at", "row_hash"]);

function jsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("Invalid archive JSON");
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, jsonValue(value[key])]));
}
function normalize(value, column, name) {
  if (value === null && column.nullable) return null;
  const type = column.type;
  if (/^(bigint|int|smallint|tinyint)/u.test(type)) {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new TypeError("Unsafe archive integer");
      value = String(value);
    }
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError("Invalid archive integer");
    const maximum = type.startsWith("bigint") ? 18446744073709551615n : type.startsWith("smallint") ? 65535n : type.startsWith("tinyint") ? 255n : 4294967295n;
    if (BigInt(value) > maximum || (name === "id" || name.endsWith("_id")) && (BigInt(value) < 1n || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))) throw new TypeError("Archive integer out of range");
    return value;
  }
  const decimal = /^decimal\((\d+),(\d+)\)$/u.exec(type);
  if (decimal) {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) throw new TypeError("Invalid archive decimal");
    const [whole, fraction = ""] = value.split("."); const scale = Number(decimal[2]);
    if (whole.length > Number(decimal[1]) - scale || fraction.length > scale) throw new TypeError("Archive decimal out of range");
    return `${whole}.${fraction.padEnd(scale, "0")}`;
  }
  if (type === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new TypeError("Invalid archive date");
    return value;
  }
  if (type === "json") return jsonValue(value);
  const size = /^(?:var)?char\((\d+)\)$/u.exec(type);
  if (!size || typeof value !== "string" || [...value].length > Number(size[1])) throw new TypeError("Invalid archive text");
  return value;
}
export function hashFulfillmentArchiveRow(table, row) {
  const contract = contracts.get(table);
  if (!contract || !row || typeof row !== "object" || Array.isArray(row)
    || Object.keys(row).some(name => !Object.hasOwn(contract.columns, name) && !metadata.has(name))) throw new TypeError("Invalid archive row");
  const values = Object.entries(contract.columns).map(([name, column]) => [name, normalize(row[name], column, name)]);
  return createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex");
}
export function hashFulfillmentArchiveTable(table, rows) {
  const hash = createHash("sha256"); let count = 0, previous = 0n;
  for (const row of rows) {
    const digest = hashFulfillmentArchiveRow(table, row), identity = BigInt(row.id);
    if (identity <= previous) throw new TypeError("Archive rows must have unique ascending IDs");
    hash.update(`${identity}:${digest}\n`); previous = identity; count++;
  }
  return { count, hash: hash.digest("hex") };
}
