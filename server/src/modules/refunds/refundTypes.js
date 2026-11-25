export const REFUND_KINDS = {
  customer: { refund: "ar_refunds", credit: "ar_credit_notes", party: "customer_id", partyKey: "customerId", permission: "ar.refund.mgmt" },
  supplier: { refund: "ap_supplier_refunds", credit: "ap_credit_notes", party: "supplier_id", partyKey: "supplierId", permission: "ap.refund.mgmt" }
};

export const REFUND_STATES = ["DRAFT", "CONFIRMED", "CANCELLED", "VOID"];
