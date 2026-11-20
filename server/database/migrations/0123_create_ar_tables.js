// 開票與應收（AR）首期的七張新表。正本是 TL 的 TABLES.md（sha256 2ffa6b0b…8aca），Sam 2026-11-19 批准
// （「批准，含作廢收款」）。欄位、鍵及約束只按該文件；不修改任何現有的表，沒有回填。
//
// 共同慣例：ID 為 BIGINT UNSIGNED；時間為 epoch 毫秒；業務日期為 DATE；金額為 DECIMAL(19,4)；代碼及狀態用
// ascii_bin 令 CHECK 分大小寫；操作者為 users 的外鍵（ON DELETE SET NULL）另存當時的顯示名稱。
// CREATE TABLE IF NOT EXISTS 令重跑是 no-op；trigger 已存在就比對定義，不同即停（ensureTriggers）。
import { ensureTriggers } from "./0114_create_purchasing_operation_requests.js";

const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";
const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

// 客戶及幣別欄位在發票與收款上相同。
const PARTY_COLUMNS = `
      customer_id             BIGINT UNSIGNED  NOT NULL,
      customer_code_snapshot  VARCHAR(100)     NOT NULL,
      customer_name_snapshot  VARCHAR(190)     NOT NULL,
      currency_code           CHAR(3)          ${ASCII} NOT NULL,
      currency_decimal_places TINYINT UNSIGNED NOT NULL,`;

export const AR_AUDIT_TRIGGERS = Object.freeze({
  trg_ar_audit_update: ["UPDATE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ar_audit_logs is immutable'"],
  trg_ar_audit_delete: ["DELETE", "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ar_audit_logs is immutable'"]
});

export async function up(connection) {
  // 1. 流水號：一類文件一年一列，取號時鎖這一列。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_document_sequences (
      document_type VARCHAR(20)       ${ASCII} NOT NULL,
      business_year SMALLINT UNSIGNED NOT NULL,
      next_value    INT UNSIGNED      NOT NULL DEFAULT 1,
      updated_at    BIGINT UNSIGNED   NOT NULL,
      PRIMARY KEY (document_type, business_year),
      CONSTRAINT chk_ar_sequence_type CHECK (document_type IN ('INVOICE', 'RECEIPT'))
    ) ${TABLE_OPTIONS}
  `);

  // 2. 操作：UNIQUE(event_id) 令同一識別只生效一次；重送時原樣回 result_summary。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_operation_requests (
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
      UNIQUE KEY uq_ar_operation_event (event_id),
      KEY idx_ar_operation_target (target_type, target_id, id),
      CONSTRAINT fk_ar_operation_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 3. 發票。outstanding_amount 直接存在發票上，帳齡表讀這一欄。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_invoices (
      id                         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      invoice_number             VARCHAR(24)      ${ASCII} NULL,
      status                     VARCHAR(20)      ${ASCII} NOT NULL DEFAULT 'DRAFT',${PARTY_COLUMNS}
      invoice_date               DATE             NOT NULL,
      due_date                   DATE             NOT NULL,
      payment_term_code_snapshot VARCHAR(50)      NOT NULL DEFAULT '',
      payment_term_name_snapshot VARCHAR(190)     NOT NULL DEFAULT '',
      due_date_overridden        TINYINT(1)       NOT NULL DEFAULT 0,
      due_date_reason            VARCHAR(500)     NOT NULL DEFAULT '',
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
      UNIQUE KEY uq_ar_invoice_number (invoice_number),
      KEY idx_ar_invoice_customer (customer_id, currency_code, status, due_date, id),
      KEY idx_ar_invoice_list (status, invoice_date, id),
      CONSTRAINT chk_ar_invoice_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID', 'CANCELLED')),
      CONSTRAINT chk_ar_invoice_amounts CHECK (total_amount >= 0 AND allocated_amount >= 0 AND outstanding_amount >= 0
        AND outstanding_amount = total_amount - allocated_amount),
      CONSTRAINT chk_ar_invoice_due_date CHECK (due_date >= invoice_date),
      CONSTRAINT fk_ar_invoice_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_invoice_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_invoice_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_invoice_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_invoice_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 4. 發票行：一行對應一個出貨行。active_shipment_line_id 在發票為 DRAFT／CONFIRMED 時等於 shipment_line_id，
  //    作廢或取消時由程式在同一交易改為 NULL；它的唯一鍵保證一個出貨行同一時間只在一張有效發票上。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_invoice_lines (
      id                      BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      invoice_id              BIGINT UNSIGNED   NOT NULL,
      line_no                 SMALLINT UNSIGNED NOT NULL,
      shipment_id             BIGINT UNSIGNED   NOT NULL,
      shipment_line_id        BIGINT UNSIGNED   NOT NULL,
      sales_order_id          BIGINT UNSIGNED   NOT NULL,
      sales_order_line_id     BIGINT UNSIGNED   NOT NULL,
      active_shipment_line_id BIGINT UNSIGNED   NULL,
      sku_code_snapshot       VARCHAR(190)      NOT NULL,
      sku_name_snapshot       VARCHAR(190)      NOT NULL,
      base_uom_code_snapshot  VARCHAR(100)      NOT NULL,
      quantity                BIGINT UNSIGNED   NOT NULL,
      unit_price_snapshot     DECIMAL(19,4)     NOT NULL,
      line_amount             DECIMAL(19,4)     NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ar_invoice_line_active_shipment_line (active_shipment_line_id),
      UNIQUE KEY uq_ar_invoice_line_no (invoice_id, line_no),
      KEY idx_ar_invoice_line_order_line (sales_order_line_id, id),
      KEY idx_ar_invoice_line_shipment (shipment_id, id),
      CONSTRAINT chk_ar_invoice_line_values CHECK (quantity > 0 AND line_amount >= 0),
      CONSTRAINT fk_ar_invoice_line_invoice FOREIGN KEY (invoice_id) REFERENCES ar_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_invoice_line_shipment FOREIGN KEY (shipment_id) REFERENCES shipments (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_invoice_line_shipment_line FOREIGN KEY (shipment_line_id) REFERENCES shipment_lines (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_invoice_line_order FOREIGN KEY (sales_order_id) REFERENCES sales_orders (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_invoice_line_order_line FOREIGN KEY (sales_order_line_id) REFERENCES sales_order_lines (id) ON DELETE RESTRICT
    ) ${TABLE_OPTIONS}
  `);

  // 5. 收款。未作廢時 amount = allocated + available；VOID 時兩者均為 0 而 amount 保留原值。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_receipts (
      id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      receipt_number     VARCHAR(24)      ${ASCII} NULL,
      status             VARCHAR(20)      ${ASCII} NOT NULL DEFAULT 'DRAFT',${PARTY_COLUMNS}
      receipt_date       DATE             NOT NULL,
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
      UNIQUE KEY uq_ar_receipt_number (receipt_number),
      KEY idx_ar_receipt_customer (customer_id, currency_code, status, receipt_date, id),
      CONSTRAINT chk_ar_receipt_amount CHECK (amount > 0),
      CONSTRAINT chk_ar_receipt_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'VOID')),
      CONSTRAINT chk_ar_receipt_method CHECK (payment_method IN ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER')),
      CONSTRAINT chk_ar_receipt_amounts CHECK ((status <> 'VOID' AND amount = allocated_amount + available_amount)
        OR (status = 'VOID' AND allocated_amount = 0 AND available_amount = 0)),
      CONSTRAINT fk_ar_receipt_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_receipt_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_receipt_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_receipt_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_receipt_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 6. 核銷：解除後保留記錄（UNAPPLIED）。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_receipt_allocations (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      receipt_id         BIGINT UNSIGNED NOT NULL,
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
      KEY idx_ar_allocation_receipt (receipt_id, status, id),
      KEY idx_ar_allocation_invoice (invoice_id, status, id),
      CONSTRAINT chk_ar_allocation_amount CHECK (amount > 0),
      CONSTRAINT chk_ar_allocation_status CHECK (status IN ('ACTIVE', 'UNAPPLIED')),
      CONSTRAINT fk_ar_allocation_receipt FOREIGN KEY (receipt_id) REFERENCES ar_receipts (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_allocation_invoice FOREIGN KEY (invoice_id) REFERENCES ar_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_allocation_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_allocation_unapplied_by FOREIGN KEY (unapplied_by) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);

  // 7. 操作記錄：欄位同 purchasing_audit_logs（0115），兩個單據欄換成 customer_id；只准 INSERT／SELECT。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_audit_logs (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      occurred_at    BIGINT UNSIGNED NOT NULL,
      actor_user_id  BIGINT UNSIGNED NULL,
      actor_label    VARCHAR(190)    NOT NULL,
      action         VARCHAR(80)     ${ASCII} NOT NULL,
      outcome        VARCHAR(20)     ${ASCII} NOT NULL,
      target_type    VARCHAR(30)     ${ASCII} NOT NULL,
      target_id      BIGINT UNSIGNED NULL,
      customer_id    BIGINT UNSIGNED NULL,
      target_label   VARCHAR(190)    NOT NULL DEFAULT '',
      reason         VARCHAR(500)    NOT NULL DEFAULT '',
      detail         JSON            NULL,
      request_id     VARCHAR(64)     NOT NULL DEFAULT '',
      correlation_id VARCHAR(64)     NOT NULL DEFAULT '',
      ip             VARCHAR(45)     NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      KEY idx_ar_audit_time (occurred_at, id),
      KEY idx_ar_audit_customer (customer_id, occurred_at, id),
      KEY idx_ar_audit_actor (actor_user_id, occurred_at, id),
      CONSTRAINT chk_ar_audit_outcome CHECK (outcome IN ('SUCCEEDED', 'REJECTED', 'FAILED')),
      CONSTRAINT chk_ar_audit_target CHECK (target_type IN ('INVOICE', 'RECEIPT', 'ALLOCATION')),
      CONSTRAINT chk_ar_audit_detail CHECK (detail IS NULL OR LENGTH(CAST(detail AS CHAR CHARSET utf8mb4)) <= 8192),
      CONSTRAINT fk_ar_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ${TABLE_OPTIONS}
  `);
  await ensureTriggers(connection, "ar_audit_logs", AR_AUDIT_TRIGGERS);
}
