// PO、PO line 同編號嘅初始不可變保護（設計 §4.16；TASK-012；HD-014）。GR／Approval／Status History 嘅 trigger
// 跟佢哋張表一齊加。Trigger 唔係授權：正常寫入仍然只經 service。
//
// - purchase_orders 離開 DRAFT 之後，商業欄位（Supplier、Currency、條款、日期、倉、Buyer、參考、備註、金額、快照、
//   編號）唔准改；只可以改狀態、進度 flag、version、updated_* 同 lifecycle 人／時間。撤回確認返 DRAFT 之後又改得。
// - purchase_order_lines：parent 唔係 DRAFT 時唔准改商業欄位，亦唔准新增或者刪除行（Sam 2026-11-02 批准，
//   唔係嘅話刪咗再加就繞過保護）；只可以改收貨／反向／結案 projection。
//   **Service 責任**：確認 PO 時要先寫晒 line 快照，先至切換表頭狀態——表頭一離開 DRAFT，line 就凍結。
// - purchasing_document_sequences：next_value 只可以唔變或者增加（§4.3 嘅 upsert 會做一次唔變嘅 UPDATE），
//   唔准 DELETE——已 commit 嘅號碼唔可以重用。
// FK 嘅 ON DELETE SET NULL（刪 user）唔會觸發 trigger，所以已確認 PO 嘅 actor 仍然可以清空。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

export const PO_PROTECTED = ["id", "po_number", "document_year_month", "sequence_no", "supplier_id", "supplier_code_snapshot",
  "supplier_name_snapshot", "ordering_address_id", "ordering_address_snapshot", "currency_code", "currency_name_snapshot",
  "currency_decimal_places_snapshot", "payment_term_id", "payment_term_snapshot", "order_date", "expected_delivery_date",
  "default_receiving_warehouse_id", "default_warehouse_code_snapshot", "buyer_id", "buyer_label", "supplier_reference", "notes",
  "subtotal_amount", "total_amount", "created_at", "created_by", "created_by_label"];
export const PO_MUTABLE = ["status", "has_outstanding", "has_confirmed_receipt", "version", "updated_at", "updated_by",
  "updated_by_label", "confirmed_at", "closed_at", "cancelled_at", "confirmed_by", "closed_by", "cancelled_by"];
export const LINE_PROTECTED = ["id", "purchase_order_id", "line_number", "sku_id", "sku_code_snapshot", "sku_name_snapshot",
  "tracking_policy_snapshot", "inventory_tracked_snapshot", "minimum_receipt_life_days_snapshot", "base_uom_id",
  "base_uom_code_snapshot", "purchase_sku_uom_id", "purchase_uom_code_snapshot", "uom_to_base_factor_snapshot",
  "supplier_sku_ref_id", "supplier_item_code_snapshot", "ordered_quantity", "ordered_base_quantity", "unit_price", "line_amount",
  "zero_price_reason", "expected_delivery_date", "line_note", "created_at"];
export const LINE_MUTABLE = ["gross_received_base_quantity", "reversed_base_quantity", "net_received_base_quantity",
  "closed_remaining_base_quantity", "has_outstanding", "is_over_received", "close_reason", "closed_at", "closed_by", "version",
  "updated_at"];

const same = (columns) => columns.map((column) => `NEW.${column} <=> OLD.${column}`).join(" AND ");
const parentStatus = (row) => `(SELECT status FROM purchase_orders WHERE id = ${row}.purchase_order_id)`;

export const PO_TRIGGERS = Object.freeze({
  trg_purchase_orders_update: ["UPDATE", `BEGIN
    IF OLD.status <> 'DRAFT' AND NOT (${same(PO_PROTECTED)}) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order commercial fields are immutable after DRAFT';
    END IF;
  END`]
});

export const LINE_TRIGGERS = Object.freeze({
  trg_po_lines_insert: ["INSERT", `BEGIN
    IF ${parentStatus("NEW")} <> 'DRAFT' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order lines cannot be added after DRAFT';
    END IF;
  END`],
  trg_po_lines_update: ["UPDATE", `BEGIN
    IF (${parentStatus("OLD")} <> 'DRAFT' AND NOT (${same(LINE_PROTECTED)}))
        OR (NOT (NEW.purchase_order_id <=> OLD.purchase_order_id) AND ${parentStatus("NEW")} <> 'DRAFT') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order line commercial fields are immutable after DRAFT';
    END IF;
  END`],
  trg_po_lines_delete: ["DELETE", `BEGIN
    IF ${parentStatus("OLD")} <> 'DRAFT' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchase order lines cannot be removed after DRAFT';
    END IF;
  END`]
});

export const SEQUENCE_TRIGGERS = Object.freeze({
  trg_purchasing_sequence_update: ["UPDATE", `BEGIN
    IF NOT (NEW.document_type <=> OLD.document_type AND NEW.\`year_month\` <=> OLD.\`year_month\`
        AND NEW.next_value >= OLD.next_value) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchasing document numbers cannot be reused';
    END IF;
  END`],
  trg_purchasing_sequence_delete: ["DELETE",
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchasing document numbers cannot be reused'"]
});

export async function up(connection) {
  await ensureTriggers(connection, "purchase_orders", PO_TRIGGERS);
  await ensureTriggers(connection, "purchase_order_lines", LINE_TRIGGERS);
  await ensureTriggers(connection, "purchasing_document_sequences", SEQUENCE_TRIGGERS);
}
