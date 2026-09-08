// 商品屬性選項（single_option 型別屬性用）。設計說明見
// docs/items_management/design_spec.md §5.10。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_attribute_options (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      attribute_id   BIGINT UNSIGNED NOT NULL,
      -- 穩定值，同一個屬性底下唯一；typed value 及 variant signature 都存呢
      -- 個 option 嘅 id，唔存呢個字串本身。
      value          VARCHAR(190)    NOT NULL,
      label          VARCHAR(190)    NOT NULL,
      sort_order     INT UNSIGNED    NOT NULL DEFAULT 0,
      status         VARCHAR(20)     NOT NULL DEFAULT 'active',
      version        INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at     BIGINT UNSIGNED NOT NULL,
      updated_at     BIGINT UNSIGNED NOT NULL,
      created_by     BIGINT UNSIGNED NULL,
      updated_by     BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_attribute_options_value (attribute_id, value),
      KEY idx_item_attribute_options_attribute (attribute_id, sort_order),
      -- CASCADE：option 係屬性自身嘅從屬資料，屬性刪咗option 冇理由留低。
      -- 「呢個 option 而家有冇被用緊」由另一條 RESTRICT FK
      -- （item_attribute_values／item_sku_attribute_values 嘅 option_id）
      -- 擋，唔係呢度。
      CONSTRAINT fk_item_attribute_options_attribute FOREIGN KEY (attribute_id)
        REFERENCES item_attribute_definitions (id) ON DELETE CASCADE,
      CONSTRAINT fk_item_attribute_options_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_attribute_options_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
