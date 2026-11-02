// PO／GR 月度編號（設計 §4.3、§8.1；TASK-011）。Primary key 按 document type 同月份隔離。
//
// next_value 上限 1000000：配出 999999 之後就係 1000000，service 會回 DOCUMENT_SEQUENCE_EXHAUSTED，
// 唔會轉成 7 位或者重置。代碼欄用 ascii_bin，CHECK 先至分大小寫（'po' 唔會當係 'PO'）。
//
// `year_month` 係 MySQL 保留字（INTERVAL 單位），所有 SQL 都要加 backtick。
export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchasing_document_sequences (
      document_type VARCHAR(10)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      \`year_month\`  CHAR(6)         CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      next_value    INT UNSIGNED    NOT NULL DEFAULT 1,
      updated_at    BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (document_type, \`year_month\`),
      CONSTRAINT chk_purchasing_sequence_type CHECK (document_type IN ('PO', 'GR')),
      CONSTRAINT chk_purchasing_sequence_month CHECK (\`year_month\` REGEXP '^[0-9]{4}(0[1-9]|1[0-2])$'),
      CONSTRAINT chk_purchasing_sequence_value CHECK (next_value BETWEEN 1 AND 1000000)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
