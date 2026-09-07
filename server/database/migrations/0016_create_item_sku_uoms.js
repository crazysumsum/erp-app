// SKU 的包裝換算單位。設計說明見 docs/items_management/design_spec.md §5.8。
//
// 每列是一個 SKU 的一個可用 UOM，Base UOM 本身也是其中一列（factor 固定 1），
// 不是另外開欄位放在 item_skus 上——這樣「一個 SKU 有幾種包裝」天生就是
// 「幾列」，不需要每加一種包裝就改一次表結構。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_sku_uoms (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sku_id                BIGINT UNSIGNED NOT NULL,
      uom_id                BIGINT UNSIGNED NOT NULL,
      -- 這個 UOM 等於多少個 Base UOM；1–1,000,000 的正整數，範圍由 service
      -- 驗證（跟 items.status 等既有欄位一樣，不靠 DB CHECK）。
      to_base_factor        INT UNSIGNED    NOT NULL,
      -- 是不是這個 SKU 的 Base UOM；是的話 factor 必須是 1（service 驗證）。
      is_base               TINYINT(1)      NOT NULL DEFAULT 0,
      is_default_purchase   TINYINT(1)      NOT NULL DEFAULT 0,
      is_default_sale       TINYINT(1)      NOT NULL DEFAULT 0,
      -- 以下三個 generated column 是同一招的三次應用（item_categories.
      -- parent_scope_id 已經用過一次）：只在「這一列就是那個角色」時才有值，
      -- 其他時候是 NULL，MySQL 的 unique key 把多個 NULL 視為互不相等，於是
      -- 「同一個 SKU 最多一個 base／預設採購／預設銷售」由資料庫本身保證，
      -- 不必只靠 service 檢查——Active SKU 恰好要有一個（不是最多一個）
      -- 仍然是 service 的責任，DB 這層只負責「不能有兩個」。
      base_slot             TINYINT GENERATED ALWAYS AS (IF(is_base = 1, 1, NULL)) STORED,
      purchase_slot         TINYINT GENERATED ALWAYS AS (IF(is_default_purchase = 1, 1, NULL)) STORED,
      sale_slot             TINYINT GENERATED ALWAYS AS (IF(is_default_sale = 1, 1, NULL)) STORED,
      version               INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at            BIGINT UNSIGNED NOT NULL,
      updated_at            BIGINT UNSIGNED NOT NULL,
      created_by            BIGINT UNSIGNED NULL,
      updated_by            BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      -- 同一個 SKU 不可以重複加同一個 UOM。
      UNIQUE KEY uq_item_sku_uoms_sku_uom (sku_id, uom_id),
      UNIQUE KEY uq_item_sku_uoms_base (sku_id, base_slot),
      UNIQUE KEY uq_item_sku_uoms_purchase (sku_id, purchase_slot),
      UNIQUE KEY uq_item_sku_uoms_sale (sku_id, sale_slot),
      -- 給 item_sku_barcodes 的 composite FK 用：確保它引用的 sku_uom_id
      -- 真的屬於它同時聲稱的 sku_id，防止把 SKU A 的條碼綁到 SKU B 的包裝
      -- 單位——跟 item_skus.uq_item_skus_id_item 同一個理由。
      UNIQUE KEY uq_item_sku_uoms_id_sku (id, sku_id),
      -- CASCADE：SKU 被刪除時，它的包裝單位列本來就沒有獨立存在的意義。
      CONSTRAINT fk_item_sku_uoms_sku FOREIGN KEY (sku_id)
        REFERENCES item_skus (id) ON DELETE CASCADE,
      -- RESTRICT：UOM 被 SKU 引用時不可刪，是 service 檢查之外的最後防線。
      CONSTRAINT fk_item_sku_uoms_uom FOREIGN KEY (uom_id)
        REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_sku_uoms_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_sku_uoms_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
