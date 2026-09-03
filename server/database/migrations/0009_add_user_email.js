// users 表加一個聯絡用嘅 email 欄。設計說明見 docs/user_management/design_spec.md
// 「已確認的決定」表（`users.email`）與 §4.5 個人資料頁。
//
// NULL、冇 UNIQUE：登入只認 username，冇任何流程要求 email 存在或唯一——
// 純聯絡資訊，需要唯一性嗰日先再開一支 migration。
//
// hasColumn 守衛嘅理由同 0006：MySQL 嘅 DDL 會隱式提交，重跑要自己收斂。

async function hasColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );

  return rows.length > 0;
}

export async function up(connection) {
  if (!(await hasColumn(connection, "users", "email"))) {
    await connection.query("ALTER TABLE users ADD COLUMN email VARCHAR(254) NULL");
  }
}
