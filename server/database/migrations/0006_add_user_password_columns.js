// users 表加兩個欄位，支撐「管理員建帳號 → 使用者首次登入必須改密碼」這條流程。
// 設計說明見 docs/user-management.md §2.1。
//
// 兩句 ALTER 放在同一支 migration，但每一句前面各自查一次 information_schema。
// 這件事是承重的，不是防禦性程式碼的裝飾：
//
//   MySQL 的 DDL 會隱式提交，而 scripts/migrate.js 只在整個 up() 成功之後才寫
//   fr_schema_migrations。所以「第一句成功、第二句失敗」會留下一個已經多了一欄、
//   但沒有被記成套用過的資料庫。沒有守衛的話重跑會炸在「欄位已存在」上，整條
//   部署流程卡死在一個要人手動判斷的狀態；有守衛的話重跑會跳過第一句、補做第二
//   句，自己收斂。
//
// 兩欄都有安全的預設（0 與 NULL），既有的列不需要回填。

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );

  return rows.length > 0;
}

export async function up(connection) {
  // 1 = 這個帳號在改掉密碼之前不能用系統。管理員建立帳號或重設密碼時設 1，
  // 使用者自己改完密碼後設 0。
  //
  // TINYINT(1) 而不是 BOOLEAN：MySQL 的 BOOLEAN 就是 TINYINT(1) 的別名，用別名
  // 只會讓 schema dump 跟這裡的 DDL 長得不一樣。
  if (!(await hasColumn(connection, "users", "must_change_password"))) {
    await connection.query(
      "ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0"
    );
  }

  // 管理員設的那個密碼有效到什麼時候為止（epoch 毫秒，與其他表一致）。
  // NULL = 不是臨時密碼，永遠有效——既有的列全部落在這一邊。
  //
  // 沒有這一欄的話，一個從來沒去登入的新帳號會帶著一個管理員知道的密碼永遠掛在
  // 那裡；那個密碼多半是用聊天軟體傳過去的。
  if (!(await hasColumn(connection, "users", "temporary_password_expires_at"))) {
    await connection.query(
      "ALTER TABLE users ADD COLUMN temporary_password_expires_at BIGINT UNSIGNED NULL"
    );
  }

  // 兩欄都不加索引：它們只會在「已經用 id 或 username 撈出那一列之後」被讀，
  // 索引在這裡是純粹的寫入成本。
}
