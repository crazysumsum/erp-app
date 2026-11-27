// Approved TABLES-AP-CREDIT.md at design commit 375b3a1bb41eb0b1a6bb12353a99fbd13853fc36.
// SHA-256: 120a730989cb85cb4ff5153ec173853c1eb45e09e5eb9d72f8dcfc0f9bdaca74
const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";
const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_credit_notes (
      id                        BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      credit_note_number        VARCHAR(24)      ${ASCII} NULL,
      status                    VARCHAR(20)      ${ASCII} NOT NULL DEFAULT 'DRAFT',
      invoice_id                BIGINT UNSIGNED  NOT NULL,
      supplier_id               BIGINT UNSIGNED  NOT NULL,
      supplier_code_snapshot    VARCHAR(64)      NOT NULL,
      supplier_name_snapshot    VARCHAR(190)     NOT NULL,
      currency_code             CHAR(3)          ${ASCII} NOT NULL,
      currency_decimal_places   TINYINT UNSIGNED NOT NULL,
      supplier_credit_reference VARCHAR(100)     NOT NULL DEFAULT '',
      credit_date               DATE             NOT NULL,
      reason                    VARCHAR(500)     NOT NULL,
      supplier_return_id        BIGINT UNSIGNED  NULL,
      total_amount              DECIMAL(19,4)    NOT NULL,
      applied_amount            DECIMAL(19,4)    NOT NULL DEFAULT 0,
      refunded_amount           DECIMAL(19,4)    NOT NULL DEFAULT 0,
      available_amount          DECIMAL(19,4)    NOT NULL,
      notes                     VARCHAR(2000)    NOT NULL DEFAULT '',
      void_reason               VARCHAR(500)     NOT NULL DEFAULT '',
      version                   INT UNSIGNED     NOT NULL DEFAULT 1,
      created_by                BIGINT UNSIGNED  NULL,
      created_by_label          VARCHAR(190)     NOT NULL,
      confirmed_by              BIGINT UNSIGNED  NULL,
      confirmed_by_label        VARCHAR(190)     NOT NULL DEFAULT '',
      confirmed_at              BIGINT UNSIGNED  NULL,
      voided_by                 BIGINT UNSIGNED  NULL,
      voided_by_label           VARCHAR(190)     NOT NULL DEFAULT '',
      voided_at                 BIGINT UNSIGNED  NULL,
      created_at                BIGINT UNSIGNED  NOT NULL,
      updated_at                BIGINT UNSIGNED  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_credit_note_number (credit_note_number),
      UNIQUE KEY uq_ap_credit_note_id_invoice (id, invoice_id),
      KEY idx_ap_credit_note_invoice (invoice_id, status, id),
      KEY idx_ap_credit_note_supplier (supplier_id, currency_code, status, credit_date, id),
      CONSTRAINT fk_ap_credit_note_invoice FOREIGN KEY (invoice_id) REFERENCES ap_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_note_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_note_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_note_return FOREIGN KEY (supplier_return_id) REFERENCES supplier_returns (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_note_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_credit_note_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_credit_note_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_ap_credit_note_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID', 'CANCELLED')),
      CONSTRAINT chk_ap_credit_note_amount CHECK (total_amount > 0),
      CONSTRAINT chk_ap_credit_note_balances CHECK (
        applied_amount >= 0 AND refunded_amount >= 0 AND available_amount >= 0
        AND ((status <> 'VOID' AND total_amount = applied_amount + refunded_amount + available_amount)
          OR (status = 'VOID' AND applied_amount = 0 AND refunded_amount = 0 AND available_amount = 0))
      )
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_credit_note_lines (
      id                      BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      credit_note_id          BIGINT UNSIGNED   NOT NULL,
      invoice_id              BIGINT UNSIGNED   NOT NULL,
      line_no                 SMALLINT UNSIGNED NOT NULL,
      invoice_line_id         BIGINT UNSIGNED   NOT NULL,
      supplier_return_line_id BIGINT UNSIGNED   NULL,
      base_quantity           BIGINT UNSIGNED   NULL,
      amount                  DECIMAL(19,4)     NOT NULL,
      description             VARCHAR(500)      NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_credit_note_line_no (credit_note_id, line_no),
      KEY idx_ap_credit_note_line_invoice_line (invoice_line_id, id),
      CONSTRAINT fk_ap_credit_note_line_credit_note FOREIGN KEY (credit_note_id, invoice_id)
        REFERENCES ap_credit_notes (id, invoice_id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_note_line_invoice_line FOREIGN KEY (invoice_line_id)
        REFERENCES ap_invoice_lines (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_note_line_return_line FOREIGN KEY (supplier_return_line_id)
        REFERENCES supplier_return_lines (id) ON DELETE RESTRICT,
      CONSTRAINT chk_ap_credit_note_line_amount CHECK (amount > 0),
      CONSTRAINT chk_ap_credit_note_line_quantity CHECK (base_quantity IS NULL OR base_quantity > 0)
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_credit_applications (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      credit_note_id     BIGINT UNSIGNED NOT NULL,
      invoice_id         BIGINT UNSIGNED NOT NULL,
      is_origin          TINYINT(1)      NOT NULL DEFAULT 0,
      amount             DECIMAL(19,4)   NOT NULL,
      status             VARCHAR(20)     ${ASCII} NOT NULL DEFAULT 'ACTIVE',
      created_by         BIGINT UNSIGNED NULL,
      created_by_label   VARCHAR(190)    NOT NULL,
      created_at         BIGINT UNSIGNED NOT NULL,
      unapplied_by       BIGINT UNSIGNED NULL,
      unapplied_by_label VARCHAR(190)    NOT NULL DEFAULT '',
      unapplied_at       BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      KEY idx_ap_credit_application_credit_note (credit_note_id, status, id),
      KEY idx_ap_credit_application_invoice (invoice_id, status, id),
      CONSTRAINT fk_ap_credit_application_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES ap_credit_notes (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_application_invoice FOREIGN KEY (invoice_id) REFERENCES ap_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_credit_application_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_credit_application_unapplied_by FOREIGN KEY (unapplied_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_ap_credit_application_amount CHECK (amount > 0),
      CONSTRAINT chk_ap_credit_application_status CHECK (status IN ('ACTIVE', 'UNAPPLIED')),
      CONSTRAINT chk_ap_credit_application_origin CHECK (is_origin IN (0, 1))
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ap_supplier_refunds (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      refund_number      VARCHAR(24)     ${ASCII} NULL,
      status             VARCHAR(20)     ${ASCII} NOT NULL DEFAULT 'DRAFT',
      credit_note_id     BIGINT UNSIGNED NOT NULL,
      supplier_id        BIGINT UNSIGNED NOT NULL,
      currency_code      CHAR(3)         ${ASCII} NOT NULL,
      refund_date        DATE            NOT NULL,
      amount             DECIMAL(19,4)   NOT NULL,
      payment_method     VARCHAR(20)     ${ASCII} NOT NULL,
      reference          VARCHAR(190)    NOT NULL DEFAULT '',
      notes              VARCHAR(2000)   NOT NULL DEFAULT '',
      void_reason        VARCHAR(500)    NOT NULL DEFAULT '',
      version            INT UNSIGNED    NOT NULL DEFAULT 1,
      created_by         BIGINT UNSIGNED NULL,
      confirmed_by       BIGINT UNSIGNED NULL,
      voided_by          BIGINT UNSIGNED NULL,
      created_by_label   VARCHAR(190)    NOT NULL,
      confirmed_by_label VARCHAR(190)    NOT NULL DEFAULT '',
      voided_by_label    VARCHAR(190)    NOT NULL DEFAULT '',
      confirmed_at       BIGINT UNSIGNED NULL,
      voided_at          BIGINT UNSIGNED NULL,
      created_at         BIGINT UNSIGNED NOT NULL,
      updated_at         BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ap_supplier_refund_number (refund_number),
      KEY idx_ap_supplier_refund_credit_note (credit_note_id, status, id),
      KEY idx_ap_supplier_refund_supplier (supplier_id, refund_date, id),
      CONSTRAINT fk_ap_supplier_refund_credit_note FOREIGN KEY (credit_note_id)
        REFERENCES ap_credit_notes (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_supplier_refund_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_supplier_refund_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ap_supplier_refund_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_supplier_refund_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ap_supplier_refund_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_ap_supplier_refund_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID', 'CANCELLED')),
      CONSTRAINT chk_ap_supplier_refund_method CHECK (payment_method IN ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER')),
      CONSTRAINT chk_ap_supplier_refund_amount CHECK (amount > 0)
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    ALTER TABLE ap_document_sequences
      DROP CHECK chk_ap_sequence_type,
      ADD CONSTRAINT chk_ap_sequence_type CHECK (document_type IN ('INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'REFUND'))
  `);
  await connection.query(`
    ALTER TABLE ap_audit_logs
      DROP CHECK chk_ap_audit_target,
      ADD CONSTRAINT chk_ap_audit_target CHECK (
        target_type IN ('INVOICE', 'PAYMENT', 'ALLOCATION', 'CREDIT_NOTE', 'CREDIT_APPLICATION', 'REFUND')
      )
  `);
}
