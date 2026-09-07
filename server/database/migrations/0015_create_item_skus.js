// Item SKU。設計說明見 docs/items_management/design_spec.md §5.7。
//
// id 是下游模組（未來 Receiving／Sales／Inventory）唯一應該外鍵的對象——它們
// 不應該直接引用 items.id，因為交易永遠是對著一個確切的 SKU 發生，不是對著
// 「這個 Item 目前隨便哪一個 SKU」。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_skus (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      item_id                  BIGINT UNSIGNED NOT NULL,
      -- 人手輸入，全域（不只同一個 Item 底下）不分大小寫唯一，靠下面
      -- UNIQUE(sku_code) 加資料庫預設的 utf8mb4_unicode_ci collation。
      sku_code                 VARCHAR(190)    NOT NULL,
      sku_name                 VARCHAR(190)    NOT NULL,
      -- Variant 規格組合的 SHA-256（例如顏色＋尺寸的排序後組合）；Standard
      -- Item 底下的 SKU 這欄是 NULL，跟下面 UNIQUE(item_id, variant_signature)
      -- 一起確保同一個 Item 底下不會有兩個規格完全相同的 variant SKU。
      variant_signature        CHAR(64)        NULL,
      -- 描述用淨含量／重量／尺寸，不是庫存單位換算——換算表是 item_sku_uoms
      -- （T09），這裡純粹是展示用的規格數字，所以用 DECIMAL 但不要求對應到
      -- 任何庫存操作。
      net_content              DECIMAL(20,6)   NULL,
      net_content_uom_id       BIGINT UNSIGNED NULL,
      weight                   DECIMAL(20,6)   NULL,
      weight_uom_id            BIGINT UNSIGNED NULL,
      length                   DECIMAL(20,6)   NULL,
      width                    DECIMAL(20,6)   NULL,
      height                   DECIMAL(20,6)   NULL,
      dimension_uom_id         BIGINT UNSIGNED NULL,
      -- none | batch | batch_expiry | serial。這是這粒 SKU 實際的追蹤政策，
      -- 建立時預設抄 items.default_tracking_policy，之後各自獨立、互不追溯。
      tracking_policy          VARCHAR(20)     NOT NULL DEFAULT 'none',
      -- tracking_policy = batch_expiry 時必填，由 service 驗證（DB 層不用
      -- CHECK constraint，理由同 items.status 的說明）。
      shelf_life_days          INT UNSIGNED    NULL,
      min_receipt_life_days    INT UNSIGNED    NULL,
      min_sale_life_days       INT UNSIGNED    NULL,
      purchasable              TINYINT(1)      NOT NULL DEFAULT 1,
      sellable                 TINYINT(1)      NOT NULL DEFAULT 1,
      inventory_tracked        TINYINT(1)      NOT NULL DEFAULT 1,
      -- 建議售價；Sellable 且 Active 時必須 > 0（service 驗證）。貨幣固定
      -- HKD，不在這裡存幣別欄位——見 itemConstants.js 的 ITEM_PRICE_CURRENCY。
      suggested_price_amount   DECIMAL(19,4)   NULL,
      effective_from           BIGINT UNSIGNED NULL,
      effective_to             BIGINT UNSIGNED NULL,
      -- draft | active | inactive | discontinued | archived（SKU lifecycle，
      -- 規則同 items.status，見 design_spec.md §4.2）。
      status                   VARCHAR(20)     NOT NULL DEFAULT 'draft',
      version                  INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at               BIGINT UNSIGNED NOT NULL,
      updated_at               BIGINT UNSIGNED NOT NULL,
      created_by               BIGINT UNSIGNED NULL,
      updated_by               BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_skus_code (sku_code),
      UNIQUE KEY uq_item_skus_item_variant (item_id, variant_signature),
      -- 給 T09 的 item_sku_uoms／item_sku_barcodes 用的 composite FK：確保它們
      -- 引用的 sku_id 真的屬於它們同時聲稱的 item_id，防止跨 Item 冒用別人的
      -- SKU id。id 本身已經是 PK，這裡是同一組欄位再包一個 unique key，不是
      -- 額外的候選鍵。
      UNIQUE KEY uq_item_skus_id_item (id, item_id),
      KEY idx_item_skus_item_status (item_id, status),
      KEY idx_item_skus_status_flags (status, purchasable, sellable),
      KEY idx_item_skus_updated (updated_at),
      -- CASCADE：只有未被引用的 Draft Item 才可以整個刪除，那時候它底下也
      -- 只會有 Draft SKU（service 保證），CASCADE 掉它們不會遺失任何已經上線
      -- 的資料——跟「永久刪除」本身的語意一致。
      CONSTRAINT fk_item_skus_item FOREIGN KEY (item_id)
        REFERENCES items (id) ON DELETE CASCADE,
      -- RESTRICT：這三個度量單位被 SKU 引用時不可刪，是 service 檢查之外的
      -- 最後防線。
      CONSTRAINT fk_item_skus_net_content_uom FOREIGN KEY (net_content_uom_id)
        REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_skus_weight_uom FOREIGN KEY (weight_uom_id)
        REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_skus_dimension_uom FOREIGN KEY (dimension_uom_id)
        REFERENCES item_uoms (id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_skus_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_skus_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
