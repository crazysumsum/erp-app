// Item 分類（樹狀結構）。設計說明見 docs/items_management/design_spec.md §5.3。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_categories (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 上層分類；NULL 表示根層級。self FK，見下方 ON DELETE RESTRICT 的說明。
      parent_id        BIGINT UNSIGNED NULL,
      -- IFNULL(parent_id, 0) 的 generated column，只為了讓下面的 unique key
      -- 對根層級也生效：MySQL 的 unique key 把多個 NULL 視為互不相等，
      -- UNIQUE(parent_id, name) 完全擋不住兩個同名的根分類——兩列的 parent_id
      -- 都是 NULL，比對永遠不相等。這裡把「根層級」統一成同一個可比較的值 0，
      -- 讓「同一父分類下名稱不可重複」對根層級與非根層級是同一條規則。
      parent_scope_id  BIGINT UNSIGNED GENERATED ALWAYS AS (IFNULL(parent_id, 0)) STORED,
      -- 分類名稱。唯一性靠下面的 unique key 加資料庫預設的
      -- utf8mb4_unicode_ci collation（見 init.sql），不分大小寫。
      name             VARCHAR(190)    NOT NULL,
      -- active | inactive | archived。不做成 ENUM：加一個狀態就要改一次表
      -- 結構。合法值由 service 驗證。
      status           VARCHAR(20)     NOT NULL DEFAULT 'active',
      -- 同一父分類下的顯示順序。
      sort_order       INT             NOT NULL DEFAULT 0,
      -- Optimistic lock：UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?。
      version          INT UNSIGNED    NOT NULL DEFAULT 1,
      created_at       BIGINT UNSIGNED NOT NULL,
      updated_at       BIGINT UNSIGNED NOT NULL,
      created_by       BIGINT UNSIGNED NULL,
      updated_by       BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      -- 同一父分類下名稱不可重複（含根層級，見 parent_scope_id 的說明）。
      UNIQUE KEY uq_item_categories_parent_name (parent_scope_id, name),
      -- 載入某一層底下的子分類、按狀態與順序排序——tree 頁面與 service 的
      -- loadTree() 的主要查詢形狀。
      KEY idx_item_categories_parent (parent_id, status, sort_order),
      -- RESTRICT 而不是 CASCADE：分類有子分類時不可刪除，這是 service 檢查
      -- 之外的最後防線——CASCADE 會讓刪一個根分類意外清空整棵子樹。
      CONSTRAINT fk_item_categories_parent FOREIGN KEY (parent_id)
        REFERENCES item_categories (id) ON DELETE RESTRICT,
      -- 帳號被刪除不影響分類本身，只是操作者欄位變 NULL。
      CONSTRAINT fk_item_categories_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_categories_updated_by FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
