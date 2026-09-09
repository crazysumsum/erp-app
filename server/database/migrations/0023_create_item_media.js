// Item／SKU media（圖片及附件）metadata。設計說明見
// docs/items_management/design_spec.md §5.11、§6.6、§8.5。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。實體檔案不落在這張表——這裡只存 metadata，落盤路徑由
// ItemMediaService／ItemMediaCleanupJob 依 stored_name 在受控 root 下解析。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_media (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      item_id        BIGINT UNSIGNED NOT NULL,
      -- NULL 表 Item 層級共用 media；有值時必須真的屬於 item_id，見下面
      -- composite FK。
      sku_id         BIGINT UNSIGNED NULL,
      -- image | attachment。
      media_kind     VARCHAR(20)     NOT NULL,
      -- 伺服器生成，不含路徑；ItemMediaService／ItemMediaCleanupJob 以外任何
      -- 程式碼都不應該自己組這個值或用它拼路徑。
      stored_name    VARCHAR(190)    NOT NULL,
      -- 顯示及下載用檔名，輸出時安全編碼；不可信任為落盤路徑的一部分。
      original_name  VARCHAR(255)    NOT NULL,
      -- 經內容簽章驗證後的實際 MIME，不是 client 宣告值。
      mime_type      VARCHAR(100)    NOT NULL,
      byte_size      BIGINT UNSIGNED NOT NULL,
      sha256         CHAR(64)        NOT NULL,
      -- 只對 media_kind = 'image' 有意義；attachment 一律 0（service 驗證）。
      is_primary     TINYINT(1)      NOT NULL DEFAULT 0,
      sort_order     INT             NOT NULL DEFAULT 0,
      -- 同一招的又一次應用（item_sku_uoms.base_slot、item_sku_barcodes.
      -- primary_scope 已經用過）：只在「這一列是這個 item／sku 範圍內的
      -- primary image」時才有值，其餘一律 NULL，MySQL unique key 視多個 NULL
      -- 互不相等——於是「同一個 Item 或同一個 SKU 最多一張 primary image」由
      -- 資料庫本身保證，不必只靠 service 檢查。sku_id 用 COALESCE(...,0) 併入
      -- 同一個 scope 字串，讓 Item 層級（sku_id NULL）同 SKU 層級各自有獨立
      -- 的 primary 名額。
      --
      -- VIRTUAL 而不是 STORED（同 item_sku_uoms／item_sku_barcodes 嗰幾個
      -- 唔同）：呢欄嘅運算式引用緊 item_id／sku_id，而呢兩欄同時又係下面
      -- ON DELETE CASCADE 嘅 FK 來源。InnoDB 唔准喺呢種情況用 STORED
      -- generated column 起 index（起表嗰陣直接 ER_CANNOT_ADD_FOREIGN，
      -- errno 1215——實測驗證過，唔係猜測），換成 VIRTUAL 就冇呢個限制，
      -- MySQL 5.7 起 InnoDB 本身就支援喺 VIRTUAL generated column 上面起
      -- secondary index（包括 UNIQUE）。
      primary_scope  VARCHAR(64) GENERATED ALWAYS AS (
                       IF(is_primary = 1 AND media_kind = 'image',
                          CONCAT(item_id, ':', COALESCE(sku_id, 0)), NULL)
                     ) VIRTUAL,
      created_at     BIGINT UNSIGNED NOT NULL,
      created_by     BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_media_stored_name (stored_name),
      UNIQUE KEY uq_item_media_primary (primary_scope),
      -- 依 Item／SKU 列出 media 的主要查詢形狀，已含顯示順序。
      KEY idx_item_media_item_sku_kind (item_id, sku_id, media_kind, sort_order),
      CONSTRAINT fk_item_media_item FOREIGN KEY (item_id)
        REFERENCES items (id) ON DELETE CASCADE,
      -- Composite FK：引用的 (sku_id, item_id) 必須真的是同一列 item_skus 的
      -- (id, item_id)，防止把 SKU A 的 media 掛去 SKU B 底下，即使兩者的
      -- sku_id 剛好撞號。sku_id 為 NULL 時（Item 層級 media）FK 不受檢查。
      -- CASCADE：media 是 SKU 的從屬資料，SKU 被刪除時一併消失，跟 barcode
      -- 需要顯式 release 的業務語意不同。
      CONSTRAINT fk_item_media_sku FOREIGN KEY (sku_id, item_id)
        REFERENCES item_skus (id, item_id) ON DELETE CASCADE,
      CONSTRAINT fk_item_media_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
