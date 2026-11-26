const CUSTOMER = Object.freeze({
  kind: "customer", code: "CUSTOMER_RETURN", prefix: "CRT-", permission: "returns.customer.mgmt",
  header: "customer_returns", lines: "customer_return_lines", source: "shipment_id", detail: "shipment_issue_detail_id"
});
const SUPPLIER = Object.freeze({
  kind: "supplier", code: "SUPPLIER_RETURN", prefix: "SRT-", permission: "returns.supplier.mgmt",
  header: "supplier_returns", lines: "supplier_return_lines", source: "goods_receipt_id", detail: "goods_receipt_detail_id"
});

export function returnType(kind) {
  if (kind === "customer") return CUSTOMER;
  if (kind === "supplier") return SUPPLIER;
  throw new TypeError("Unknown return kind");
}

export const RETURN_STATUSES = ["DRAFT", "POSTED", "CANCELLED"];
export const RETURN_STOCK_STATUSES = ["AVAILABLE", "QUARANTINED", "DAMAGED"];
