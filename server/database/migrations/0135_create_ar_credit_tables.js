// TABLES-AR-CREDIT.md at 375b3a1b, approved 2026-11-25 (sha256 08dbe5d8…bad262).
const ASCII = "CHARACTER SET ascii COLLATE ascii_bin";
const TABLE_OPTIONS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_credit_notes (
      id                       BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      credit_note_number       VARCHAR(24)      ${ASCII} NULL,
      status                   VARCHAR(20)      ${ASCII} NOT NULL DEFAULT 'DRAFT',
      invoice_id               BIGINT UNSIGNED  NOT NULL,
      customer_id              BIGINT UNSIGNED  NOT NULL,
      customer_code_snapshot   VARCHAR(100)     NOT NULL,
      customer_name_snapshot   VARCHAR(190)     NOT NULL,
      currency_code            CHAR(3)          ${ASCII} NOT NULL,
      currency_decimal_places  TINYINT UNSIGNED NOT NULL,
      credit_date              DATE             NOT NULL,
      reason                   VARCHAR(500)     NOT NULL,
      customer_return_id       BIGINT UNSIGNED  NULL,
      total_amount             DECIMAL(19,4)    NOT NULL,
      applied_amount           DECIMAL(19,4)    NOT NULL DEFAULT 0,
      refunded_amount          DECIMAL(19,4)    NOT NULL DEFAULT 0,
      available_amount         DECIMAL(19,4)    NOT NULL,
      notes                    VARCHAR(2000)    NOT NULL DEFAULT '',
      void_reason              VARCHAR(500)     NOT NULL DEFAULT '',
      version                  INT UNSIGNED     NOT NULL DEFAULT 1,
      created_by               BIGINT UNSIGNED  NULL,
      created_by_label         VARCHAR(190)     NOT NULL,
      confirmed_by             BIGINT UNSIGNED  NULL,
      confirmed_by_label       VARCHAR(190)     NOT NULL DEFAULT '',
      confirmed_at             BIGINT UNSIGNED  NULL,
      voided_by                BIGINT UNSIGNED  NULL,
      voided_by_label          VARCHAR(190)     NOT NULL DEFAULT '',
      voided_at                BIGINT UNSIGNED  NULL,
      created_at               BIGINT UNSIGNED  NOT NULL,
      updated_at               BIGINT UNSIGNED  NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ar_credit_note_number (credit_note_number),
      UNIQUE KEY uq_ar_credit_note_invoice (id, invoice_id),
      KEY idx_ar_credit_note_invoice (invoice_id, status, id),
      KEY idx_ar_credit_note_customer (customer_id, currency_code, status, credit_date, id),
      CONSTRAINT fk_ar_credit_note_invoice FOREIGN KEY (invoice_id) REFERENCES ar_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_note_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_note_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_note_return FOREIGN KEY (customer_return_id) REFERENCES customer_returns (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_note_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_credit_note_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_credit_note_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_ar_credit_note_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID', 'CANCELLED')),
      CONSTRAINT chk_ar_credit_note_total CHECK (total_amount > 0),
      CONSTRAINT chk_ar_credit_note_amounts CHECK (applied_amount >= 0 AND refunded_amount >= 0 AND available_amount >= 0
        AND ((status <> 'VOID' AND total_amount = applied_amount + refunded_amount + available_amount)
          OR (status = 'VOID' AND applied_amount = 0 AND refunded_amount = 0 AND available_amount = 0)))
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_credit_note_lines (
      id                       BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
      credit_note_id           BIGINT UNSIGNED   NOT NULL,
      invoice_id               BIGINT UNSIGNED   NOT NULL,
      line_no                  SMALLINT UNSIGNED NOT NULL,
      invoice_line_id          BIGINT UNSIGNED   NULL,
      customer_return_line_id  BIGINT UNSIGNED   NULL,
      base_quantity            BIGINT UNSIGNED   NULL,
      amount                   DECIMAL(19,4)     NOT NULL,
      description              VARCHAR(500)      NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      UNIQUE KEY uq_ar_credit_note_line_no (credit_note_id, line_no),
      KEY idx_ar_credit_note_line_invoice (invoice_line_id, id),
      CONSTRAINT fk_ar_credit_note_line_note FOREIGN KEY (credit_note_id, invoice_id) REFERENCES ar_credit_notes (id, invoice_id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_note_line_invoice FOREIGN KEY (invoice_line_id) REFERENCES ar_invoice_lines (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_note_line_return FOREIGN KEY (customer_return_line_id) REFERENCES customer_return_lines (id) ON DELETE RESTRICT,
      CONSTRAINT chk_ar_credit_note_line_amount CHECK (amount > 0),
      CONSTRAINT chk_ar_credit_note_line_quantity CHECK (base_quantity IS NULL OR base_quantity > 0)
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_credit_applications (
      id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      credit_note_id      BIGINT UNSIGNED NOT NULL,
      invoice_id          BIGINT UNSIGNED NOT NULL,
      is_origin           TINYINT(1)      NOT NULL DEFAULT 0,
      amount              DECIMAL(19,4)   NOT NULL,
      status              VARCHAR(20)     ${ASCII} NOT NULL DEFAULT 'ACTIVE',
      created_by          BIGINT UNSIGNED NULL,
      created_by_label    VARCHAR(190)    NOT NULL,
      created_at          BIGINT UNSIGNED NOT NULL,
      unapplied_by        BIGINT UNSIGNED NULL,
      unapplied_by_label  VARCHAR(190)    NOT NULL DEFAULT '',
      unapplied_at        BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      KEY idx_ar_credit_application_note (credit_note_id, status, id),
      KEY idx_ar_credit_application_invoice (invoice_id, status, id),
      CONSTRAINT fk_ar_credit_application_note FOREIGN KEY (credit_note_id) REFERENCES ar_credit_notes (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_application_invoice FOREIGN KEY (invoice_id) REFERENCES ar_invoices (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_credit_application_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_credit_application_unapplied_by FOREIGN KEY (unapplied_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_ar_credit_application_amount CHECK (amount > 0),
      CONSTRAINT chk_ar_credit_application_status CHECK (status IN ('ACTIVE', 'UNAPPLIED')),
      CONSTRAINT chk_ar_credit_application_origin CHECK (is_origin IN (0, 1))
    ) ${TABLE_OPTIONS}
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ar_refunds (
      id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      refund_number       VARCHAR(24)     ${ASCII} NULL,
      status              VARCHAR(20)     ${ASCII} NOT NULL DEFAULT 'DRAFT',
      credit_note_id      BIGINT UNSIGNED NOT NULL,
      customer_id         BIGINT UNSIGNED NOT NULL,
      currency_code       CHAR(3)         ${ASCII} NOT NULL,
      refund_date         DATE            NOT NULL,
      amount              DECIMAL(19,4)   NOT NULL,
      payment_method      VARCHAR(20)     ${ASCII} NOT NULL,
      reference           VARCHAR(190)    NOT NULL DEFAULT '',
      notes               VARCHAR(2000)   NOT NULL DEFAULT '',
      void_reason         VARCHAR(500)    NOT NULL DEFAULT '',
      version             INT UNSIGNED    NOT NULL DEFAULT 1,
      created_by          BIGINT UNSIGNED NULL,
      confirmed_by        BIGINT UNSIGNED NULL,
      voided_by           BIGINT UNSIGNED NULL,
      created_by_label    VARCHAR(190)    NOT NULL,
      confirmed_by_label  VARCHAR(190)    NOT NULL DEFAULT '',
      voided_by_label     VARCHAR(190)    NOT NULL DEFAULT '',
      confirmed_at        BIGINT UNSIGNED NULL,
      voided_at           BIGINT UNSIGNED NULL,
      created_at          BIGINT UNSIGNED NOT NULL,
      updated_at          BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_ar_refund_number (refund_number),
      KEY idx_ar_refund_note (credit_note_id, status, id),
      KEY idx_ar_refund_customer (customer_id, refund_date, id),
      CONSTRAINT fk_ar_refund_note FOREIGN KEY (credit_note_id) REFERENCES ar_credit_notes (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_refund_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_refund_currency FOREIGN KEY (currency_code) REFERENCES currencies (code) ON DELETE RESTRICT,
      CONSTRAINT fk_ar_refund_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_refund_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_ar_refund_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT chk_ar_refund_status CHECK (status IN ('DRAFT', 'CONFIRMED', 'VOID', 'CANCELLED')),
      CONSTRAINT chk_ar_refund_method CHECK (payment_method IN ('BANK_TRANSFER', 'CHEQUE', 'CASH', 'OTHER')),
      CONSTRAINT chk_ar_refund_amount CHECK (amount > 0)
    ) ${TABLE_OPTIONS}
  `);

  // Replace each CHECK in one ALTER so a retry never sees it missing.
  await connection.query(`
    ALTER TABLE ar_document_sequences
      DROP CHECK chk_ar_sequence_type,
      ADD CONSTRAINT chk_ar_sequence_type CHECK (document_type IN ('INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'REFUND'))
  `);
  await connection.query(`
    ALTER TABLE ar_audit_logs
      DROP CHECK chk_ar_audit_target,
      ADD CONSTRAINT chk_ar_audit_target CHECK (target_type IN ('INVOICE', 'RECEIPT', 'ALLOCATION', 'CREDIT_NOTE', 'CREDIT_APPLICATION', 'REFUND'))
  `);
}
