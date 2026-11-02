import { createHash } from "node:crypto";

// Fixed original business columns from the Sales 0073–0079 contracts.
const CONTRACTS = {
  "sales_orders": {
    "id": ["bigint unsigned"],
    "sales_order_number": ["varchar(20)",false],
    "status": ["varchar(30)",false],
    "source_type": ["varchar(20)",false],
    "source_quotation_id": ["bigint unsigned",true],
    "source_intake_order_id": ["bigint unsigned",true],
    "external_order_key_id": ["bigint unsigned",true],
    "channel_code_snapshot": ["varchar(50)",false],
    "external_order_id_snapshot": ["varchar(190)",false],
    "customer_id": ["bigint unsigned"],
    "customer_code_snapshot": ["varchar(100)"],
    "customer_name_snapshot": ["varchar(190)"],
    "currency_code": ["char(3)",false],
    "payment_term_id": ["bigint unsigned",true],
    "payment_term_code_snapshot": ["varchar(50)",false],
    "payment_term_name_snapshot": ["varchar(190)",false],
    "credit_status_snapshot": ["varchar(20)",false],
    "credit_limit_snapshot": ["decimal(19,4)",true],
    "credit_currency_snapshot": ["char(3)",true],
    "credit_policy_version_snapshot": ["int unsigned",true],
    "fulfillment_warehouse_id": ["bigint unsigned"],
    "warehouse_code_snapshot": ["varchar(100)"],
    "warehouse_name_snapshot": ["varchar(190)"],
    "order_date": ["date"],
    "requested_delivery_date": ["date",true],
    "customer_po_reference": ["varchar(190)",false],
    "notes": ["varchar(2000)",false],
    "line_count": ["smallint unsigned"],
    "total_amount": ["decimal(19,4)"],
    "has_backorder": ["tinyint(1)",false],
    "backorder_line_count": ["smallint unsigned",false],
    "version": ["int unsigned",false],
    "confirmation_event_id": ["char(36)",true],
    "confirmed_at": ["bigint unsigned",true],
    "cancelled_at": ["bigint unsigned",true],
    "closed_at": ["bigint unsigned",true],
    "confirmed_by": ["bigint unsigned",true],
    "cancelled_by": ["bigint unsigned",true],
    "closed_by": ["bigint unsigned",true],
    "cancel_reason": ["varchar(500)",false],
    "close_reason": ["varchar(500)",false],
    "created_at": ["bigint unsigned"],
    "updated_at": ["bigint unsigned"],
    "last_business_updated_at": ["bigint unsigned"],
    "created_by": ["bigint unsigned",true],
    "updated_by": ["bigint unsigned",true]
  },
  "sales_order_lines": {
    "id": ["bigint unsigned"],
    "sales_order_id": ["bigint unsigned"],
    "line_no": ["smallint unsigned"],
    "sku_id": ["bigint unsigned"],
    "item_name_snapshot": ["varchar(190)"],
    "sku_code_snapshot": ["varchar(190)"],
    "sku_name_snapshot": ["varchar(190)"],
    "sku_uom_id": ["bigint unsigned"],
    "uom_code_snapshot": ["varchar(100)"],
    "uom_name_snapshot": ["varchar(100)"],
    "to_base_factor_snapshot": ["int unsigned"],
    "tracking_policy_snapshot": ["varchar(30)",false],
    "minimum_sale_life_days_snapshot": ["int unsigned",false],
    "ordered_quantity": ["decimal(20,6)"],
    "ordered_base_quantity": ["bigint unsigned"],
    "unit_selling_price": ["decimal(19,4)"],
    "price_source": ["varchar(20)",false],
    "line_amount": ["decimal(19,4)"],
    "reserved_outstanding_base_quantity": ["bigint unsigned",false],
    "backordered_base_quantity": ["bigint unsigned",false],
    "fulfilled_base_quantity": ["bigint unsigned",false],
    "cancelled_base_quantity": ["bigint unsigned",false],
    "line_note": ["varchar(500)",false],
    "version": ["int unsigned",false],
    "created_at": ["bigint unsigned"],
    "updated_at": ["bigint unsigned"]
  },
  "sales_order_line_reservations": {
    "id": ["bigint unsigned"],
    "sales_order_line_id": ["bigint unsigned"],
    "inventory_reservation_id": ["bigint unsigned"],
    "inventory_operation_id": ["bigint unsigned"],
    "source_event_id": ["char(36)",false],
    "original_base_quantity": ["bigint unsigned"],
    "consumed_base_quantity": ["bigint unsigned",false],
    "released_base_quantity": ["bigint unsigned",false],
    "outstanding_base_quantity": ["bigint unsigned"],
    "status": ["varchar(30)",false],
    "inventory_version": ["int unsigned"],
    "created_at": ["bigint unsigned"],
    "updated_at": ["bigint unsigned"]
  },
  "sales_backorder_entries": {
    "id": ["bigint unsigned"],
    "sales_order_id": ["bigint unsigned"],
    "sales_order_line_id": ["bigint unsigned"],
    "line_no": ["smallint unsigned"],
    "warehouse_id": ["bigint unsigned"],
    "sku_id": ["bigint unsigned"],
    "outstanding_base_quantity": ["bigint unsigned"],
    "status": ["varchar(20)",false],
    "priority_at": ["bigint unsigned"],
    "last_allocation_event_id": ["char(36)",true],
    "next_attempt_at": ["bigint unsigned"],
    "last_attempt_at": ["bigint unsigned",true],
    "attempt_count": ["int unsigned",false],
    "last_error_code": ["varchar(80)",false],
    "version": ["int unsigned",false],
    "created_at": ["bigint unsigned"],
    "updated_at": ["bigint unsigned"]
  },
  "sales_order_status_history": {
    "id": ["bigint unsigned"],
    "sales_order_id": ["bigint unsigned"],
    "sequence_no": ["int unsigned"],
    "from_status": ["varchar(30)",true],
    "to_status": ["varchar(30)",false],
    "action": ["varchar(50)",false],
    "reason": ["varchar(500)",false],
    "order_version_after": ["int unsigned"],
    "event_id": ["char(36)",false],
    "actor_user_id": ["bigint unsigned",true],
    "actor_label": ["varchar(190)"],
    "occurred_at": ["bigint unsigned"]
  },
  "sales_audit_logs": {
    "id": ["bigint unsigned"],
    "occurred_at": ["bigint unsigned"],
    "actor_user_id": ["bigint unsigned",true],
    "actor_label": ["varchar(190)"],
    "action": ["varchar(80)",false],
    "target_type": ["varchar(30)",false],
    "target_id": ["bigint unsigned",true],
    "target_number": ["varchar(30)",false],
    "outcome": ["varchar(20)",false],
    "reason": ["varchar(500)",false],
    "details": ["json",true],
    "event_id": ["char(36)",false],
    "request_id": ["varchar(64)",false],
    "correlation_id": ["varchar(64)",false],
    "ip_address": ["varchar(45)",false]
  }
};
export const SALES_ARCHIVE_COLUMNS = Object.freeze(Object.fromEntries(Object.entries(CONTRACTS).map(([table,columns]) => [table,Object.freeze(Object.keys(columns))])));
const METADATA = new Set(["archive_batch_id","archived_at","row_hash"]);
const fail = () => { throw new TypeError("Invalid Sales Archive row contract"); };
function integer(value, type, identity) {
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail(); value=String(value); }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) fail();
  const number=BigInt(value), maximum=identity?BigInt(Number.MAX_SAFE_INTEGER):type.startsWith("bigint")?18446744073709551615n:type.startsWith("int")?4294967295n:type.startsWith("smallint")?65535n:127n;
  if (number>maximum || identity && number===0n) fail();
  return value;
}
function canonicalJson(value, ancestors=new Set()) {
  if (value===null || typeof value==="string" || typeof value==="boolean") return value;
  if (typeof value==="number") { if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) fail(); return value; }
  if (typeof value!=="object" || ancestors.has(value)) fail();
  ancestors.add(value); let result;
  if (Array.isArray(value)) {
    if (Object.keys(value).length!==value.length) fail();
    result=Array.from(value,item=>canonicalJson(item,ancestors));
  } else {
    if (![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail();
    result=Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalJson(value[key],ancestors)]));
  }
  ancestors.delete(value); return result;
}
function normalize(value, column, [type,nullable=false]) {
  if (value===null) { if (!nullable) fail(); return null; }
  if (/^(bigint|int|smallint|tinyint)/u.test(type)) return integer(value,type,column==="id" || column.endsWith("_id"));
  const decimal=/^decimal\((\d+),(\d+)\)$/u.exec(type);
  if (decimal) {
    if (typeof value!=="string" || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/u.test(value)) fail();
    const negative=value.startsWith("-"), [whole,fraction=""]=value.replace(/^-/u,"").split("."), scale=Number(decimal[2]);
    if (whole.length>Number(decimal[1])-scale || fraction.length>scale) fail();
    const digits=whole+fraction; return `${negative && /[1-9]/u.test(digits)?"-":""}${whole}.${fraction.padEnd(scale,"0")}`;
  }
  if (type==="date") {
    if (typeof value!=="string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/u.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) fail();
    return value;
  }
  if (type==="json") return canonicalJson(value);
  const text=/^(?:var)?char\((\d+)\)$/u.exec(type);
  if (!text || typeof value!=="string" || [...value].length>Number(text[1])) fail();
  return value;
}
function contract(table) { if (!Object.hasOwn(CONTRACTS,table)) fail(); return CONTRACTS[table]; }
export function hashSalesArchiveRow(table,row) {
  const columns=contract(table);
  if (!row || Array.isArray(row) || typeof row!=="object" || Object.keys(row).some(key=>!Object.hasOwn(columns,key) && !METADATA.has(key))) fail();
  const pairs=Object.entries(columns).map(([column,type])=>{ if (!Object.hasOwn(row,column)) fail(); return [column,normalize(row[column],column,type)]; });
  return createHash("sha256").update(JSON.stringify(pairs),"utf8").digest("hex");
}
export async function hashSalesArchiveRows(table,rows) {
  contract(table); const digest=createHash("sha256"); let previous=0n,count=0;
  for await (const row of rows) {
    const hash=hashSalesArchiveRow(table,row),id=BigInt(row.id);
    if (id<=previous) fail(); previous=id; count+=1; digest.update(`${id}:${hash}\n`);
  }
  return {count,hash:digest.digest("hex")};
}
