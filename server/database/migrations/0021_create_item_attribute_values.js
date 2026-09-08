// Item 層級嘅屬性值（typed value）。設計說明見
// docs/items_management/design_spec.md §5.10。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_attribute_values (
      item_id         BIGINT UNSIGNED NOT NULL,
      attribute_id    BIGINT UNSIGNED NOT NULL,
      -- 下面 5 個 value 欄位，service 保證按屬性嘅 data_type 淨係一個有值——
      -- 唔用單一 JSON 欄，係因為 typed columns 先做得到型別驗證、索引同未來
      -- 報表（design_spec §5.10）。MySQL 5.7 唔支援 CHECK constraint，所以
      -- 「淨係一個有值」呢條規則淨係喺 service 層做，呢度冇強制。
      option_id       BIGINT UNSIGNED NULL,
      value_text      TEXT            NULL,
      value_decimal   DECIMAL(20,6)   NULL,
      value_boolean   TINYINT(1)      NULL,
      -- epoch 毫秒，同呢個 codebase 其他時間欄位一致。
      value_date      BIGINT UNSIGNED NULL,
      updated_at      BIGINT UNSIGNED NOT NULL,
      updated_by      BIGINT UNSIGNED NULL,
      PRIMARY KEY (item_id, attribute_id),
      KEY idx_item_attribute_values_option (option_id),
      -- CASCADE：屬性值係 Item aggregate 自身嘅從屬資料，同 item_sku_uoms／
      -- item_sku_barcodes 跟 SKU 走同一個道理——Item 冇咗，佢啲屬性值一齊冇。
      CONSTRAINT fk_item_attribute_values_item FOREIGN KEY (item_id)
        REFERENCES items (id) ON DELETE CASCADE,
      -- RESTRICT：屬性定義係共用 catalog 資料。
      CONSTRAINT fk_item_attribute_values_attribute FOREIGN KEY (attribute_id)
        REFERENCES item_attribute_definitions (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_attribute_values_option FOREIGN KEY (option_id)
        REFERENCES item_attribute_options (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_attribute_values_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
