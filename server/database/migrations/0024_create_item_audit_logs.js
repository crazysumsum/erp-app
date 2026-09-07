// Item Management 的變更紀錄。設計說明見
// docs/items_management/design_spec.md §5.12。
//
// 跟 0007_add_user_audit_logs.js 分表而不是共用 user_audit_logs：Item 的
// target_type 種類（item／sku／category／brand／uom／attribute／media／import）
// 遠比用戶管理多，混在一起會讓用戶稽核頁的查詢跟著背 Item 那一堆種類的成本，
// 也會讓「使用者稽核」跟「商品稽核」這兩個本來不相關的頁面共用同一張表。
//
// 编號维持設計書原訂的 0024（items／skus 表的編號 0014／0015 之前）：這張表
// 不依賴 items／skus——target_id 刻意不設外鍵，所以可以先建，讓 Catalog
// （Category／Brand／UOM）的寫入路徑從一開始就能正確寫稽核，不用等 Item／SKU
// 主表就緒後再回頭補。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_audit_logs (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 事件發生時間（epoch 毫秒），來源是 time service 的 nowMs()，與其他表一致。
      occurred_at    BIGINT UNSIGNED NOT NULL,
      -- 操作者。帳號日後若真的被硬刪除，這裡變 NULL 但記錄本身留著。
      actor_user_id  BIGINT UNSIGNED NULL,
      -- 操作者當下的帳號名，冗餘保存，理由與 user_audit_logs 相同：join 回
      -- users 只會拿到「現在的名字」，稽核記錄的價值就是它在事後還讀得懂。
      actor_username VARCHAR(190)    NOT NULL,
      -- category.create | category.update | category.status | category.delete
      -- | brand.create | ... | item.create | sku.status | barcode.release | ...
      -- 完整清單見 design_spec.md §8.7。不做成 ENUM：加一個動作就要改一次表
      -- 結構，約束靠寫入端。
      action         VARCHAR(80)     NOT NULL,
      -- item | sku | category | brand | uom | attribute | media | import
      target_type    VARCHAR(30)     NOT NULL,
      -- 刻意不設外鍵：對象被永久刪除之後，「誰在什麼時候刪的」這一列必須留
      -- 得住，而外鍵只有 CASCADE（連記錄一起刪）與 SET NULL（丟掉是哪一個）
      -- 兩種選擇，兩種都比留一個失效的 id 差。target_label 補上人讀得懂的
      -- 那一半。
      target_id      BIGINT UNSIGNED NULL,
      -- 對象當下的名稱／Code，理由同 actor_username。
      target_label   VARCHAR(190)    NOT NULL,
      -- 操作者填的原因。高風險動作必填（見 design_spec.md §3.2），其餘留空字串。
      reason         VARCHAR(190)    NOT NULL DEFAULT '',
      -- 變更前後的值。密碼、雜湊、token、Authorization header、CSV 內容不會
      -- 出現在這裡；寫入前檢查序列化後的長度，過大時由呼叫端截斷成摘要。
      detail         JSON            NULL,
      -- 對得回請求日誌（logs/requests-*.log）的那一次請求。
      request_id     VARCHAR(64)     NOT NULL DEFAULT '',
      -- IPv6 也放得下。
      ip             VARCHAR(45)     NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      -- 稽核頁的預設查詢：照時間倒序翻頁。
      KEY idx_item_audit_logs_time (occurred_at),
      -- 「這個分類／SKU 被誰動過什麼」——事後追查最常問的一句。比
      -- user_audit_logs 多一個 target_type：Item 的對象種類多，同一個
      -- target_id 在不同種類之間會撞號（例如 category id 1 與 sku id 1）。
      KEY idx_item_audit_logs_target (target_type, target_id, occurred_at),
      -- 「這個人做過什麼」。
      KEY idx_item_audit_logs_actor (actor_user_id, occurred_at),
      -- 依動作類型查詢，例如「所有的停用操作」。
      KEY idx_item_audit_logs_action (action, occurred_at),
      -- SET NULL 而不是 CASCADE：稽核記錄不能因為操作者的帳號沒了就跟著消失
      -- ——那正好是最需要它的情況。actor_username 就是為了這一刻存在的。
      CONSTRAINT fk_item_audit_logs_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
