// 分類與商品屬性嘅對應規則。設計說明見
// docs/items_management/design_spec.md §5.10、§6.4。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_category_attributes (
      category_id              BIGINT UNSIGNED NOT NULL,
      attribute_id              BIGINT UNSIGNED NOT NULL,
      -- 呢個屬性喺呢個分類底下係咪「要啟用先必填」。
      required_for_activation  TINYINT(1)      NOT NULL DEFAULT 0,
      sort_order                INT UNSIGNED    NOT NULL DEFAULT 0,
      created_at                BIGINT UNSIGNED NOT NULL,
      updated_at                BIGINT UNSIGNED NOT NULL,
      -- 純 mapping 表，冇 version：呢類規則透過 Category 本身嘅
      -- expectedAttributeIds compare-and-set 一次性整組覆蓋（design_spec
      -- §6.4），唔係逐行改，所以冇個別 version／created_by／updated_by 嘅
      -- 需要——邊個幾時改咗，由 Category 自己嗰筆 audit 記錄。
      PRIMARY KEY (category_id, attribute_id),
      KEY idx_item_category_attributes_attribute (attribute_id),
      -- CASCADE：分類刪咗，佢同邊啲屬性掛鈎呢個 mapping 冇意思留低。
      CONSTRAINT fk_item_category_attributes_category FOREIGN KEY (category_id)
        REFERENCES item_categories (id) ON DELETE CASCADE,
      -- RESTRICT：屬性仲有分類用緊就唔可以刪——同 item_category_attributes
      -- 以外，屬性本身係共用 catalog 資料嘅慣例一致。
      CONSTRAINT fk_item_category_attributes_attribute FOREIGN KEY (attribute_id)
        REFERENCES item_attribute_definitions (id) ON DELETE RESTRICT
    )
  `);
}
