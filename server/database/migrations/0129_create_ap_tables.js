// Sam 2026-11-24 批准的 AP r5（設計提交 8f0c308770777118530294487aa263de61e782eb）。
// TABLES.md SHA-256: e3d0412e4716c3b19957fa228ff3901f7197bed2da1029779ac31239093e86f5
// 只新增 AP 七張表，不修改既有表或回填資料。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";
const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// 供應商及幣別欄位在發票與付款上相同。
const PARTY_COLUMNS = `
      supplier_id             BIGINT UNSIGNED  NOT NULL,
      supplier_code_snapshot  VARCHAR(64)      NOT NULL,
      supplier_name_snapshot  VARCHAR(190)     NOT NULL,
      currency_code           CHAR(3)          ${ASCII} NOT NULL,
      currency_decimal_places TINYINT UNSIGNED NOT NULL,`;

export const AP_AUDIT_TRIGGERS = Object.freeze({
  trg_ap_audit_update: ["UPDATE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ap_audit_logs is immutable'"],
  trg_ap_audit_delete: ["DELETE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ap_audit_logs is immutable'"]
});

export async function up(connection) {
  // 1. 流水號：一類文件一年一列，取號時鎖這一列。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_document_sequences (
      document_type VARCHAR(20)       ${ASCII} NOT NULL,
      business_year SMALLINT UNSIGNED NOT NULL,
      next_value    INT UNSIGNED      NOT NULL DEFAULT 1,
      updated_at    BIGINT UNSIGNED   NOT NULL,
      PRIMARY KEY (document_type, business_year),
      CONSTRAINT chk_ap_sequence_type CHECK (document_type IN ('INVOICE', 'PAYMENT'))
    ) ${TABLE_OPTIONS}
  `);

  // 2. 操作：UNIQUE(event_id) 令同一識別只生效一次；重送時原樣回 result_summary。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_operation_requests (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_id       CHAR(36)        ${ASCII} NOT NULL,
      command_type   VARCHAR(40)     ${ASCII} NOT NULL,
      target_type    VARCHAR(20)     ${ASCII} NOT NULL,
      target_id      BIGINT UNSIGNED NOT NULL DEFAULT 0,
      request_hash   CHAR(64)        ${ASCII} NOT NULL,
      actor_user_id  BIGINT UNSIGNED NULL,
      actor_label    VARCHAR(190)    NOT NULL,
      result_summary JSON            NULL,
      created_at     BIGINT UNSIGNED NOT NULL,
      completed_at   BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_operation_event (event_id),
      KEY idx_ap_operation_target (target_type, target_id, id),
      CONSTRAINT fk_ap_operation_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 3. 發票。outstanding_amount 直接存在發票上，帳齡表讀這一欄。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_invoices (
      id                         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      invoice_number             VARCHAR(24)      ${ASCII} NULL,
      status                     VARCHAR(20)      ${ASCII} NOT NULL DEFAULT 'DRAFT',${PARTY_COLUMNS}
      supplier_invoice_number    VARCHAR(100)     NOT NULL,
      active_supplier_invoice_key VARCHAR(100)    COLLATE utf8mb4_bin NULL,
      invoice_date               DATE             NOT NULL,
      due_date                   DATE             NOT NULL,
      payment_term_code_snapshot VARCHAR(50)      NOT NULL DEFAULT '',
      payment_term_name_snapshot VARCHAR(190)     NOT NULL DEFAULT '',
      due_date_overridden        TINYINT(1)       NOT NULL DEFAULT 0,
      due_date_reason            VARCHAR(500)     NOT NULL DEFAULT '',
      supplier_total_amount      DECIMAL(19,4)    NULL,
      no_po_reason               VARCHAR(500)     NOT NULL DEFAULT '',
      total_amount               DECIMAL(19,4)    NOT NULL,
      allocated_amount           DECIMAL(19,4)    NOT NULL DEFAULT 0,
      outstanding_amount         DECIMAL(19,4)    NOT NULL,
      notes                      VARCHAR(2000)    NOT NULL DEFAULT '',
      void_reason                VARCHAR(500)     NOT NULL DEFAULT '',
      version                    INT UNSIGNED     NOT NULL DEFAULT 1,
      created_by                 BIGINT UNSIGNED  NULL,
      created_by_label           VARCHAR(190)     NOT NULL,
      confirmed_by               BIGINT UNSIGNED  NULL,
      confirmed_by_label         VARCHAR(190)     NOT NULL DEFAULT '',
      confirmed_at               BIGINT UNSIGNED  NULL,
      voided_by                  BIGINT UNSIGNED  NULL,
      voided_by_label            VARCHAR(190)     NOT NULL DEFAULT '',
      voided_at                  BIGINT UNSIGNED  NULL,
      created_at                 BIGINT UNSIGNED  NOT NULL,
      updated_at                 BIGINT UNSIGNED  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_invoice_number (invoice_number),
      UNIQUE KEY uq_ap_invoice_active_supplier_number (supplier_id, active_supplier_invoice_key),
      KEY idx_ap_invoice_supplier (supplier_id, currency_code, status, due_date, id),
      KEY idx_ap_invoice_list (status, invoice_date, id),
      CONSTRAINT chk_ap_invoice_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID', 'CANCELLED')),
      CONSTRAINT chk_ap_invoice_amounts CHECK (total_amount >= 0 AND allocated_amount >= 0 AND outstanding_amount >= 0
        AND outstanding_amount = total_amount - allocated_amount),
      CONSTRAINT chk_ap_invoice_supplier_total CHECK (supplier_total_amount IS NULL OR supplier_total_amount >= 0),
      CONSTRAINT chk_ap_invoice_due_date CHECK (due_date >= invoice_date),
      CONSTRAINT fk_ap_invoice_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_invoice_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_invoice_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_invoice_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_invoice_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 4. 作廢或取消時由應付交易釋放全部收貨行的 active_goods_receipt_line_id。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_invoice_lines (
      id                            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      invoice_id                    BIGINT UNSIGNED   NOT NULL,
      line_no                       SMALLINT UNSIGNED NOT NULL,
      line_type                     VARCHAR(20)       ${ASCII} NOT NULL,
      goods_receipt_id              BIGINT UNSIGNED   NULL,
      goods_receipt_line_id         BIGINT UNSIGNED   NULL,
      active_goods_receipt_line_id  BIGINT UNSIGNED   NULL,
      purchase_order_id             BIGINT UNSIGNED   NULL,
      purchase_order_line_id        BIGINT UNSIGNED   NULL,
      goods_receipt_number_snapshot VARCHAR(20)       ${ASCII} NOT NULL DEFAULT '',
      purchase_order_number_snapshot VARCHAR(20)      ${ASCII} NOT NULL DEFAULT '',
      sku_code_snapshot             VARCHAR(190)      NOT NULL DEFAULT '',
      sku_name_snapshot             VARCHAR(190)      NOT NULL DEFAULT '',
      base_uom_code_snapshot        VARCHAR(50)       NOT NULL DEFAULT '',
      purchase_uom_code_snapshot    VARCHAR(50)       NOT NULL DEFAULT '',
      to_base_factor_snapshot       INT UNSIGNED      NOT NULL DEFAULT 1,
      quantity                      BIGINT UNSIGNED   NOT NULL DEFAULT 0,
      po_unit_price_snapshot        DECIMAL(19,4)     NOT NULL DEFAULT 0,
      po_line_amount                DECIMAL(19,4)     NOT NULL DEFAULT 0,
      line_amount                   DECIMAL(19,4)     NOT NULL,
      amount_override_reason        VARCHAR(500)      NOT NULL DEFAULT '',
      description                   VARCHAR(500)      NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_invoice_line_active_receipt_line (active_goods_receipt_line_id),
      UNIQUE KEY uq_ap_invoice_line_no (invoice_id, line_no),
      KEY idx_ap_invoice_line_receipt (goods_receipt_id, id),
      CONSTRAINT chk_ap_invoice_line_type CHECK (line_type IN ('RECEIPT', 'EXPENSE')),
      CONSTRAINT chk_ap_invoice_line_source CHECK (
        (line_type = 'RECEIPT' AND goods_receipt_id IS NOT NULL AND goods_receipt_line_id IS NOT NULL AND quantity > 0)
        OR (line_type = 'EXPENSE' AND goods_receipt_id IS NULL AND goods_receipt_line_id IS NULL
          AND active_goods_receipt_line_id IS NULL AND quantity = 0 AND po_line_amount = 0
          AND line_amount > 0 AND amount_override_reason = '')
      ),
      CONSTRAINT chk_ap_invoice_line_amounts CHECK (po_unit_price_snapshot >= 0 AND po_line_amount >= 0 AND line_amount >= 0),
      CONSTRAINT fk_ap_invoice_line_invoice FOREIGN KEY (invoice_id) REFERENCES ap_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_invoice_line_receipt FOREIGN KEY (goods_receipt_id) REFERENCES goods_receipts (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_invoice_line_receipt_line FOREIGN KEY (goods_receipt_line_id, goods_receipt_id)
        REFERENCES goods_receipt_lines (id, goods_receipt_id) ON DELETE RESTRICT
    ) ${TABLE_OPTIONS}
  `);

  // 5. 付款。未作廢時 amount = allocated + available；VOID 時兩者均為 0 而 amount 保留原值。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_payments (
      id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      payment_number     VARCHAR(24)      ${ASCII} NULL,
      status             VARCHAR(20)      ${ASCII} NOT NULL DEFAULT 'DRAFT',${PARTY_COLUMNS}
      payment_date       DATE             NOT NULL,
      amount             DECIMAL(19,4)    NOT NULL,
      allocated_amount   DECIMAL(19,4)    NOT NULL DEFAULT 0,
      available_amount   DECIMAL(19,4)    NOT NULL,
      payment_method     VARCHAR(20)      ${ASCII} NOT NULL,
      reference          VARCHAR(190)     NOT NULL DEFAULT '',
      notes              VARCHAR(2000)    NOT NULL DEFAULT '',
      void_reason        VARCHAR(500)     NOT NULL DEFAULT '',
      voided_by          BIGINT UNSIGNED  NULL,
      voided_by_label    VARCHAR(190)     NOT NULL DEFAULT '',
      voided_at          BIGINT UNSIGNED  NULL,
      version            INT UNSIGNED     NOT NULL DEFAULT 1,
      created_by         BIGINT UNSIGNED  NULL,
      created_by_label   VARCHAR(190)     NOT NULL,
      confirmed_by       BIGINT UNSIGNED  NULL,
      confirmed_by_label VARCHAR(190)     NOT NULL DEFAULT '',
      confirmed_at       BIGINT UNSIGNED  NULL,
      created_at         BIGINT UNSIGNED  NOT NULL,
      updated_at         BIGINT UNSIGNED  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_payment_number (payment_number),
      KEY idx_ap_payment_supplier (supplier_id, currency_code, status, payment_date, id),
      CONSTRAINT chk_ap_payment_amount CHECK (amount > 0),
      CONSTRAINT chk_ap_payment_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'VOID')),
      CONSTRAINT chk_ap_payment_method CHECK (payment_method IN ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER')),
      CONSTRAINT chk_ap_payment_amounts CHECK ((status <> 'VOID' AND amount = allocated_amount + available_amount)
        OR (status = 'VOID' AND allocated_amount = 0 AND available_amount = 0)),
      CONSTRAINT fk_ap_payment_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_payment_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_payment_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_payment_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_payment_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 6. 核銷：解除後保留記錄（UNAPPLIED）。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_payment_allocations (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      payment_id         BIGINT UNSIGNED NOT NULL,
      invoice_id         BIGINT UNSIGNED NOT NULL,
      amount             DECIMAL(19,4)   NOT NULL,
      status             VARCHAR(20)     ${ASCII} NOT NULL DEFAULT 'ACTIVE',
      created_by         BIGINT UNSIGNED NULL,
      created_by_label   VARCHAR(190)    NOT NULL,
      created_at         BIGINT UNSIGNED NOT NULL,
      unapplied_by       BIGINT UNSIGNED NULL,
      unapplied_by_label VARCHAR(190)    NOT NULL DEFAULT '',
      unapplied_at       BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      KEY idx_ap_allocation_payment (payment_id, status, id),
      KEY idx_ap_allocation_invoice (invoice_id, status, id),
      CONSTRAINT chk_ap_allocation_amount CHECK (amount > 0),
      CONSTRAINT chk_ap_allocation_status CHECK (status IN ('ACTIVE', 'UNAPPLIED')),
      CONSTRAINT fk_ap_allocation_payment FOREIGN KEY (payment_id) REFERENCES ap_payments (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_allocation_invoice FOREIGN KEY (invoice_id) REFERENCES ap_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_allocation_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_allocation_unapplied_by FOREIGN KEY (unapplied_by) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 7. 操作記錄：欄位同 purchasing_audit_logs（0115），供應商 ID 保留為快照；只准 INSERT／SELECT。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_audit_logs (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      occurred_at    BIGINT UNSIGNED NOT NULL,
      actor_user_id  BIGINT UNSIGNED NULL,
      actor_label    VARCHAR(190)    NOT NULL,
      action         VARCHAR(80)     ${ASCII} NOT NULL,
      outcome        VARCHAR(20)     ${ASCII} NOT NULL,
      target_type    VARCHAR(30)     ${ASCII} NOT NULL,
      target_id      BIGINT UNSIGNED NULL,
      supplier_id    BIGINT UNSIGNED NULL,
      target_label   VARCHAR(190)    NOT NULL DEFAULT '',
      reason         VARCHAR(500)    NOT NULL DEFAULT '',
      detail         JSON            NULL,
      request_id     VARCHAR(64)     NOT NULL DEFAULT '',
      correlation_id VARCHAR(64)     NOT NULL DEFAULT '',
      ip             VARCHAR(45)     NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      KEY idx_ap_audit_time (occurred_at, id),
      KEY idx_ap_audit_supplier (supplier_id, occurred_at, id),
      KEY idx_ap_audit_actor (actor_user_id, occurred_at, id),
      CONSTRAINT chk_ap_audit_outcome CHECK (outcome IN ('SUCCEEDED', 'REJECTED', 'FAILED')),
      CONSTRAINT chk_ap_audit_target CHECK (target_type IN ('INVOICE', 'PAYMENT', 'ALLOCATION')),
      CONSTRAINT chk_ap_audit_detail CHECK (detail IS NULL OR LENGTH(CAST(detail AS CHAR CHARSET utf8mb4)) <= 8192),
      CONSTRAINT fk_ap_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);
  await ensureTriggers(connection, "ap_audit_logs", AP_AUDIT_TRIGGERS);
}
