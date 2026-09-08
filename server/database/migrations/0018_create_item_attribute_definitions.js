// 商品屬性定義。設計說明見 docs/items_management/design_spec.md §5.10。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_attribute_definitions (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 穩定代碼，建立後不可改。
      code           VARCHAR(80)     NOT NULL,
      name           VARCHAR(190)    NOT NULL,
      -- text | long_text | decimal | boolean | date | single_option。不做
      -- ENUM，理由同其他狀態欄位——加一種型別不必改表結構，合法值由 service
      -- 驗證。
      data_type      VARCHAR(20)     NOT NULL,
      -- 數值屬性嘅顯示單位（例如「容量」用 ml）；非數值屬性用唔著就係 NULL。
      uom_id         BIGINT UNSIGNED NULL,
      -- 呢個屬性可唔可以用嚟分辨唔同 SKU（例如顏色、容量）；描述性屬性
      -- （例如成分、過敏原）呢個係 0。
      is_variant     TINYINT(1)      NOT NULL DEFAULT 0,
      -- 是否出現喺搜尋篩選。
      is_filterable  TINYINT(1)      NOT NULL DEFAULT 0,
      status         VARCHAR(20)     NOT NULL DEFAULT 'active',
      version        INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at     BIGINT UNSIGNED NOT NULL,
      updated_at     BIGINT UNSIGNED NOT NULL,
      created_by     BIGINT UNSIGNED NULL,
      updated_by     BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_attribute_definitions_code (code),
      KEY idx_item_attribute_definitions_status (status, name),
      CONSTRAINT fk_item_attribute_definitions_uom FOREIGN KEY (uom_id)
        REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_attribute_definitions_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_attribute_definitions_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
