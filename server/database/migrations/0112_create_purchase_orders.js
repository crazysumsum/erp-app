// Purchase Order header（設計 §4.5；TASK-011；HD-012）。
//
// 同設計原文嘅分別（Sam 2026-11-02 批准）：
// - currency_code 跟 currencies.code 用 ascii／ascii_bin；唔係嘅話 FK 因為字元集唔相容建唔到。
// - Ordering address 用 composite FK (ordering_address_id, supplier_id) → supplier_addresses(id, supplier_id)，
//   DB 層擋住「用咗另一個 Supplier 嘅地址」；ordering_address_id 係 NULL 時唔檢查。
// - 加 CHECK：po_number 同 document_year_month／sequence_no 一致、7 個狀態、Currency 小數位 0～4、金額 ≥ 0。
// 代碼欄用 ascii_bin，令 CHECK 分大小寫。
//
// 純新增；CREATE TABLE 喺 MySQL 8.0 係原子 DDL，IF NOT EXISTS 令重跑係 no-op。
export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id                               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      po_number                        VARCHAR(20)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      document_year_month              CHAR(6)          CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sequence_no                      INT UNSIGNED     NOT NULL,
      supplier_id                      BIGINT UNSIGNED  NOT NULL,
      supplier_code_snapshot           VARCHAR(64)      NOT NULL,
      supplier_name_snapshot           VARCHAR(190)     NOT NULL,
      ordering_address_id              BIGINT UNSIGNED  NULL,
      ordering_address_snapshot        JSON             NULL,
      currency_code                    CHAR(3)          CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      currency_name_snapshot           VARCHAR(100)     NOT NULL,
      currency_decimal_places_snapshot TINYINT UNSIGNED NOT NULL,
      payment_term_id                  BIGINT UNSIGNED  NULL,
      payment_term_snapshot            JSON             NULL,
      order_date                       DATE             NOT NULL,
      expected_delivery_date           DATE             NULL,
      default_receiving_warehouse_id   BIGINT UNSIGNED  NULL,
      default_warehouse_code_snapshot  VARCHAR(50)      NOT NULL DEFAULT '',
      buyer_id                         BIGINT UNSIGNED  NULL,
      buyer_label                      VARCHAR(190)     NOT NULL,
      supplier_reference               VARCHAR(190)     NOT NULL DEFAULT '',
      notes                            VARCHAR(2000)    NOT NULL DEFAULT '',
      status                           VARCHAR(30)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
      subtotal_amount                  DECIMAL(25,4)    NOT NULL DEFAULT 0,
      total_amount                     DECIMAL(25,4)    NOT NULL DEFAULT 0,
      has_outstanding                  TINYINT(1)       NOT NULL DEFAULT 1,
      has_confirmed_receipt            TINYINT(1)       NOT NULL DEFAULT 0,
      version                          INT UNSIGNED     NOT NULL DEFAULT 1,
      created_at                       BIGINT UNSIGNED  NOT NULL,
      updated_at                       BIGINT UNSIGNED  NOT NULL,
      created_by                       BIGINT UNSIGNED  NULL,
      updated_by                       BIGINT UNSIGNED  NULL,
      created_by_label                 VARCHAR(190)     NOT NULL,
      updated_by_label                 VARCHAR(190)     NOT NULL,
      confirmed_at                     BIGINT UNSIGNED  NULL,
      closed_at                        BIGINT UNSIGNED  NULL,
      cancelled_at                     BIGINT UNSIGNED  NULL,
      confirmed_by                     BIGINT UNSIGNED  NULL,
      closed_by                        BIGINT UNSIGNED  NULL,
      cancelled_by                     BIGINT UNSIGNED  NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_purchase_orders_number (po_number),
      UNIQUE KEY uq_purchase_orders_sequence (document_year_month, sequence_no),
      UNIQUE KEY uq_purchase_orders_id_supplier (id, supplier_id),
      KEY idx_po_list (status, updated_at, id),
      KEY idx_po_supplier (supplier_id, status, order_date, id),
      KEY idx_po_buyer (buyer_id, status, order_date, id),
      KEY idx_po_currency (currency_code, status, id),
      KEY idx_po_delivery (status, expected_delivery_date, id),
      KEY idx_po_outstanding (has_outstanding, status, expected_delivery_date, id),
      KEY idx_po_ordering_address (ordering_address_id, supplier_id),
      CONSTRAINT chk_po_number CHECK (po_number = CONCAT('PO-', document_year_month, '-', LPAD(sequence_no, 6, '0'))),
      CONSTRAINT chk_po_month CHECK (document_year_month REGEXP '^[0-9]{4}(0[1-9]|1[0-2])$'),
      CONSTRAINT chk_po_sequence CHECK (sequence_no BETWEEN 1 AND 999999),
      CONSTRAINT chk_po_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'PARTIALLY_RECEIVED',
        'FULLY_RECEIVED', 'CLOSED', 'CANCELLED')),
      CONSTRAINT chk_po_values CHECK (currency_decimal_places_snapshot BETWEEN 0 AND 4 AND subtotal_amount >= 0
        AND total_amount >= 0 AND has_outstanding IN (0, 1) AND has_confirmed_receipt IN (0, 1) AND version >= 1),
      CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_ordering_address FOREIGN KEY (ordering_address_id, supplier_id)
        REFERENCES supplier_addresses (id, supplier_id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_po_payment_term FOREIGN KEY (payment_term_id) REFERENCES payment_terms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_warehouse FOREIGN KEY (default_receiving_warehouse_id)
        REFERENCES inventory_warehouses (id) ON DELETE RESTRICT,
      CONSTRAINT fk_po_buyer FOREIGN KEY (buyer_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_closed_by FOREIGN KEY (closed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_po_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
