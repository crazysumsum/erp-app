// Item 計量單位（Base UOM／Pack UOM 的目錄）。設計說明見
// docs/items_management/design_spec.md §5.5。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_uoms (
      id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 穩定代碼，例如 EA、BOX、CTN。全域唯一；SKU UOM／barcode／attribute
      -- 未來都以這個 id 引用，code 只是給人看與匯入匹配用。
      code       VARCHAR(50)     NOT NULL,
      name       VARCHAR(100)    NOT NULL,
      symbol     VARCHAR(30)     NOT NULL DEFAULT '',
      -- active | inactive | archived。不做成 ENUM，理由同 item_categories。
      status     VARCHAR(20)     NOT NULL DEFAULT 'active',
      version    INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_uoms_code (code),
      KEY idx_item_uoms_status_name (status, name),
      CONSTRAINT fk_item_uoms_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_uoms_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
