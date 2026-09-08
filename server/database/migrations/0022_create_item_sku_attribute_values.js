// SKU 層級嘅屬性值（typed value）——Variant 組合用嚟分辨唔同 SKU 嘅正正就係
// 呢張表嘅資料。設計說明見 docs/items_management/design_spec.md §4.4、§5.10。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_sku_attribute_values (
      sku_id          BIGINT UNSIGNED NOT NULL,
      attribute_id    BIGINT UNSIGNED NOT NULL,
      -- 形狀同 item_attribute_values 一致，理由見嗰張表嘅註解。呢度額外嘅
      -- 業務規則（service 負責）：淨係 is_variant = 1 嘅屬性先可以喺呢度有
      -- 值——variant_signature 就係靠呢啲值計出嚟嘅。
      option_id       BIGINT UNSIGNED NULL,
      value_text      TEXT            NULL,
      value_decimal   DECIMAL(20,6)   NULL,
      value_boolean   TINYINT(1)      NULL,
      value_date      BIGINT UNSIGNED NULL,
      updated_at      BIGINT UNSIGNED NOT NULL,
      updated_by      BIGINT UNSIGNED NULL,
      PRIMARY KEY (sku_id, attribute_id),
      KEY idx_item_sku_attribute_values_option (option_id),
      CONSTRAINT fk_item_sku_attribute_values_sku FOREIGN KEY (sku_id)
        REFERENCES item_skus (id) ON DELETE CASCADE,
      CONSTRAINT fk_item_sku_attribute_values_attribute FOREIGN KEY (attribute_id)
        REFERENCES item_attribute_definitions (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_sku_attribute_values_option FOREIGN KEY (option_id)
        REFERENCES item_attribute_options (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_sku_attribute_values_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
