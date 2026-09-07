// Item 品牌。設計說明見 docs/items_management/design_spec.md §5.4。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_brands (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 全公司唯一，不分大小寫（靠資料庫預設的 utf8mb4_unicode_ci collation，
      -- 見 init.sql）。
      name           VARCHAR(190)    NOT NULL,
      official_name  VARCHAR(190)    NOT NULL DEFAULT '',
      description    VARCHAR(1000)   NOT NULL DEFAULT '',
      -- active | inactive | archived。不做成 ENUM，理由同 item_categories。
      status         VARCHAR(20)     NOT NULL DEFAULT 'active',
      version        INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at     BIGINT UNSIGNED NOT NULL,
      updated_at     BIGINT UNSIGNED NOT NULL,
      created_by     BIGINT UNSIGNED NULL,
      updated_by     BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_brands_name (name),
      KEY idx_item_brands_status_name (status, name),
      CONSTRAINT fk_item_brands_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_brands_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
