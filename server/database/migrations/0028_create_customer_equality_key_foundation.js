// TASK-003 establishes only the Customer identity/equality-key foundation that
// normalization and real-MySQL constraint tests need. TASK-005 extends this
// additive table with lifecycle, audit and shared-catalog columns; this migration
// intentionally does not invent those dependencies early.

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_code     VARCHAR(64) NOT NULL,
      customer_code_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      legal_name        VARCHAR(190) NOT NULL,
      legal_name_key    VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      created_at        BIGINT UNSIGNED NOT NULL,
      updated_at        BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customers_code_key (customer_code_key),
      UNIQUE KEY uq_customers_legal_name_key (legal_name_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
