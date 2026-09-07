// Item 主資料。設計說明見 docs/items_management/design_spec.md §5.6。
//
// 已確認本期不加 Item Code：Item 只用內部 id，交易識別靠 SKU Code（見
// item_skus.sku_code）——兩套人手代碼會互相搶用途。同理沒有 tenant、cost、
// tax setting 欄位：單一公司、HKD、tax_not_applicable 全部是常數（見
// itemConstants.js），不進表。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS items (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name                     VARCHAR(190)    NOT NULL,
      -- POS／窄版畫面用的短名，跟 name 分開存，不是在畫面上截斷 name。
      short_name               VARCHAR(100)    NOT NULL DEFAULT '',
      -- 純文字；4,000 字元上限由 API request schema 檢查，這裡用 TEXT 留餘裕。
      description              TEXT            NULL,
      -- Draft 可以未分類；Active 必須有分類——那條規則在 service 驗證，不是
      -- 靠這裡的 NULL/NOT NULL（狀態機不同階段的必填欄位不一樣，硬性 NOT NULL
      -- 反而擋不住「先建 Draft、之後補分類」這個正常流程）。
      category_id              BIGINT UNSIGNED NULL,
      brand_id                 BIGINT UNSIGNED NULL,
      -- standard | variant。不做 ENUM：加一種類型就要改一次表結構，合法值由
      -- service 驗證——跟 item_categories.status 等既有欄位同一個理由。
      product_type             VARCHAR(20)     NOT NULL DEFAULT 'standard',
      -- ISO 3166-1 alpha-2，例如 'HK'、'CN'。
      country_of_origin        CHAR(2)         NULL,
      manufacturer             VARCHAR(190)    NOT NULL DEFAULT '',
      -- none | batch | batch_expiry | serial。建立 SKU 時的預設值，之後改這
      -- 個欄位不會追溯覆寫已經存在的 SKU（見 item_skus.tracking_policy）。
      default_tracking_policy  VARCHAR(20)     NOT NULL DEFAULT 'none',
      default_shelf_life_days  INT UNSIGNED    NULL,
      -- draft | active | inactive | discontinued | archived（Item lifecycle，
      -- 完整轉換規則見 design_spec.md §7 之後的生命週期章節，這裡不重複）。
      status                   VARCHAR(20)     NOT NULL DEFAULT 'draft',
      -- Optimistic lock：UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?。
      version                  INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at               BIGINT UNSIGNED NOT NULL,
      updated_at               BIGINT UNSIGNED NOT NULL,
      created_by               BIGINT UNSIGNED NULL,
      updated_by               BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      -- 列表頁預設排序（最近更新在前），同時篩狀態。
      KEY idx_items_status_updated (status, updated_at),
      -- 依分類／品牌篩選時同時帶狀態。
      KEY idx_items_category_status (category_id, status),
      KEY idx_items_brand_status (brand_id, status),
      -- 依名稱搜尋。
      KEY idx_items_name (name),
      -- RESTRICT：分類／品牌被 Item 引用時不可刪，這是 service 檢查之外的
      -- 最後防線——跟 item_categories.parent_id 的自我 FK 同一個理由。
      CONSTRAINT fk_items_category FOREIGN KEY (category_id)
        REFERENCES item_categories (id) ON DELETE RESTRICT,
      CONSTRAINT fk_items_brand FOREIGN KEY (brand_id)
        REFERENCES item_brands (id) ON DELETE RESTRICT,
      -- 帳號被刪除不影響 Item 本身，只是操作者欄位變 NULL。
      CONSTRAINT fk_items_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_items_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
