// SKU 條碼。設計說明見 docs/items_management/design_spec.md §5.9。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_sku_barcodes (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      sku_id               BIGINT UNSIGNED NOT NULL,
      sku_uom_id           BIGINT UNSIGNED NOT NULL,
      -- 原始顯示值（掃描器／列印用）。
      barcode              VARCHAR(190)    NOT NULL,
      -- 正規化之後用來比對唯一性的值；正規化規則（例如去除前導零、統一大小
      -- 寫）由 service 決定，這裡只負責存與唯一約束。
      normalized_barcode   VARCHAR(190)    NOT NULL,
      -- gtin8 | upca | ean13 | gtin14 | internal。不做 ENUM，理由同其他狀態
      -- 欄位——加一種類型不必改表結構，合法值由 service 驗證。
      barcode_type         VARCHAR(20)     NOT NULL,
      -- 這個包裝單位的主要條碼；同一個 sku_uom_id 最多一個。
      is_primary           TINYINT(1)      NOT NULL DEFAULT 0,
      -- 同一招的第四次應用：只在 is_primary = 1 時等於 sku_uom_id，其他
      -- 時候是 NULL，讓下面 UNIQUE(sku_id, primary_scope) 只擋「同一個
      -- sku_uom_id 標了兩次 primary」，不影響同一 SKU 底下不同包裝單位
      -- 各自有自己的 primary。
      primary_scope        BIGINT GENERATED ALWAYS AS (IF(is_primary = 1, sku_uom_id, NULL)) STORED,
      version              INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at           BIGINT UNSIGNED NOT NULL,
      updated_at           BIGINT UNSIGNED NOT NULL,
      created_by           BIGINT UNSIGNED NULL,
      updated_by           BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      -- 全域唯一，封存的條碼仍然佔用——防止兩個不同商品共用同一個實體條碼，
      -- 即使其中一個已經停產。
      UNIQUE KEY uq_item_sku_barcodes_normalized (normalized_barcode),
      UNIQUE KEY uq_item_sku_barcodes_primary (sku_id, primary_scope),
      -- 依 SKU／包裝單位查條碼的主要查詢形狀。
      KEY idx_item_sku_barcodes_sku_uom (sku_id, sku_uom_id),
      -- Composite FK：引用的 (sku_uom_id, sku_id) 必須真的是同一列
      -- item_sku_uoms 的 (id, sku_id)，防止把 SKU A 的條碼綁到 SKU B 的包裝
      -- 單位——即使兩者的 sku_uom_id 剛好撞號也擋得住，因為 FK 同時檢查
      -- sku_id 那一半。
      --
      -- RESTRICT 而不是 CASCADE：design_spec.md §6.3 有一支專門的
      -- POST /skus/:id/barcodes/:barcodeId/release（jwt-device-password，
      -- 高風險再認證），條碼的移除是一個要 reason／audit 的明確業務動作，不
      -- 應該因為包裝單位被整組替換（SKU update 用完整集合＋version 覆蓋
      -- UOM／barcode，見 §6.3 前言）就默默消失。有條碼掛著的包裝單位刪不掉，
      -- service 必須先引導使用者釋放條碼。
      CONSTRAINT fk_item_sku_barcodes_sku_uom FOREIGN KEY (sku_uom_id, sku_id)
        REFERENCES item_sku_uoms (id, sku_id) ON DELETE RESTRICT,
      CONSTRAINT fk_item_sku_barcodes_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_sku_barcodes_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
