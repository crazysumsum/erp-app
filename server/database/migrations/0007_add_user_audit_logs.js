// 用戶與角色管理的變更紀錄。設計說明見 docs/user_management/design_spec.md §2.2。
//
// user_ 前綴而不是 fr_：與 user_devices、user_device_nonces 同族。「要不要留
// 稽核」是業務政策，不是框架機制。
//
// 純新增，不動任何既有表。一句 DDL，而且是 CREATE TABLE IF NOT EXISTS，所以
// 重跑本身就是安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_audit_logs (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 事件發生時間（epoch 毫秒），與其他表一致，來源是 time service 的 nowMs()。
      occurred_at    BIGINT UNSIGNED NOT NULL,
      -- 操作者。帳號日後若真的被硬刪除，這裡變 NULL 但記錄本身留著。
      actor_user_id  BIGINT UNSIGNED NULL,
      -- 操作者當下的帳號名，冗餘保存。沒有它的話，改名或刪帳號會讓整段歷史指向
      -- 一個查不到的 id——稽核記錄的價值就是它在事後還讀得懂。join 回 users 只
      -- 會拿到「現在的名字」，那是另一個問題的答案。
      actor_username VARCHAR(190)    NOT NULL,
      -- user.create | user.update | user.disable | user.enable | user.roles
      -- | user.password.reset | user.password.change
      -- | role.create | role.update | role.delete | role.permissions
      --
      -- 不做成 ENUM：加一個動作就要改一次表結構，而這串會長。約束靠寫入端。
      action         VARCHAR(60)     NOT NULL,
      -- user | role
      target_type    VARCHAR(20)     NOT NULL,
      -- 刻意不設外鍵：角色被刪掉之後，「誰在什麼時候刪的」這一列必須留得住，
      -- 而外鍵只有 CASCADE（連記錄一起刪）與 SET NULL（丟掉是哪一個）兩種選擇，
      -- 兩種都比留一個失效的 id 差。target_label 補上人讀得懂的那一半。
      target_id      BIGINT UNSIGNED NULL,
      -- 對象當下的名字（username 或角色名），理由同 actor_username。
      target_label   VARCHAR(190)    NOT NULL,
      -- 操作者填的原因。高風險動作必填（見 §3.1），其餘留空字串。
      reason         VARCHAR(190)    NOT NULL DEFAULT '',
      -- 變更前後的值，例如 {"roles":{"before":["staff"],"after":["staff","admin"]}}。
      -- 密碼、雜湊、token、Authorization header 永遠不會出現在這裡；改密碼類的
      -- 動作只記「改過」這件事。寫入前檢查序列化後的長度，超過 4KB 就截成一個
      -- {"truncated":true} 的摘要——稽核記錄不該因為某次塞了一個巨大的 payload
      -- 而讓整個交易失敗。
      detail         JSON            NULL,
      -- 對得回請求日誌（logs/requests-*.log）的那一次請求。
      request_id     VARCHAR(64)     NOT NULL DEFAULT '',
      -- IPv6 也放得下。
      ip             VARCHAR(45)     NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      -- 三個索引，各自對應一句實際會問的話。沒有第四個：其他查法一年跑不到幾次，
      -- 而每個索引都是每次寫入都要付的成本。
      --
      -- 稽核頁的預設查詢：照時間倒序翻頁。
      KEY idx_user_audit_logs_time (occurred_at),
      -- 「這個帳號被誰動過什麼」——事後追查最常問的一句。
      KEY idx_user_audit_logs_target (target_type, target_id, occurred_at),
      -- 「這個人做過什麼」。
      KEY idx_user_audit_logs_actor (actor_user_id, occurred_at),
      -- SET NULL 而不是 CASCADE：稽核記錄不能因為操作者的帳號沒了就跟著消失
      -- ——那正好是最需要它的情況。actor_username 就是為了這一刻存在的。
      CONSTRAINT fk_user_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
