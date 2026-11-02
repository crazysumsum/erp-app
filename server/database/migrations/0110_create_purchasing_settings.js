// Purchasing 設定（設計 §4.4；TASK-011）：全公司一筆，本期只有 require_po_approval，預設 OFF。
//
// 純新增，不動任何既有表。MySQL 8.0 嘅 CREATE TABLE 係原子 DDL，IF NOT EXISTS 令重跑係 no-op。
// 預設 row 只喺唔存在時先 insert：唔用 INSERT IGNORE（會吞埋其他錯誤），重跑亦唔會覆蓋已改過嘅設定。
//
// 0102 空咗，但 0105–0109 已被進行中嘅 sales-archive branch 佔用，所以 Purchasing 由 0110 開始。
export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchasing_settings (
      id                  TINYINT UNSIGNED NOT NULL,
      require_po_approval TINYINT(1)       NOT NULL DEFAULT 0,
      version             INT UNSIGNED     NOT NULL DEFAULT 1,
      updated_at          BIGINT UNSIGNED  NOT NULL,
      updated_by          BIGINT UNSIGNED  NULL,
      updated_by_label    VARCHAR(190)     NOT NULL,
      PRIMARY KEY (id),
      CONSTRAINT chk_purchasing_settings_singleton CHECK (id = 1),
      CONSTRAINT chk_purchasing_settings_values CHECK (require_po_approval IN (0, 1) AND version >= 1),
      CONSTRAINT fk_purchasing_settings_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [rows] = await connection.query("SELECT id FROM purchasing_settings WHERE id = 1");
  if (rows.length === 0) {
    await connection.execute(
      `INSERT INTO purchasing_settings (id, require_po_approval, version, updated_at, updated_by, updated_by_label)
       VALUES (1, 0, 1, ?, NULL, 'system')`,
      [Date.now()]
    );
  }
}
