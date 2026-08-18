// 登入所需的業務資料表：使用者、角色、權限。
//
// 沒有 fr_ 前綴，因為這些是業務資料而不是框架自己的表——框架只擁有 fr_ 開頭的
// 表，這幾張由專案擁有。
//
// 授權策略 hasRole / hasPermission 讀的是 JWT claims 裡的 roles / permissions，
// 所以角色與權限只在登入當下被讀出來寫進 token；請求路徑上不會再查這幾張表。
// 代價是改完權限要等 token 過期或撤銷才生效，換到的是每個請求少三次 join。
// 要即時生效就對該使用者 revoke，下次登入會拿到新的 claims。
//
// 時間一律存 epoch 毫秒（BIGINT UNSIGNED），與 fr_schema_migrations.applied_at
// 一致，也與 time service 的 nowMs() 對得上。不用 DATETIME 是因為它會把值綁進
// 資料庫的時區設定，而這個系統的時區只有一個來源：APP_TIME_ZONE。
//
// 寫成 JS 而不是 SQL 的唯一理由是下面那個守衛：這個 migration 需要刪掉一張叫
// users 的表，而 `DROP TABLE IF EXISTS users` 在一個 ERP 裡是最不該靜默執行的
// 一句 SQL。守衛確認它真的是 init.sql 那張示範表之後才刪，否則中止並要求人工
// 處理——寧可 migration 失敗，也不要無聲刪掉真的使用者資料。

// init.sql 曾經建立的示範表的完整欄位集合。多一欄少一欄都代表它已經不是那張
// 示範表，也就不該由這個 migration 決定它的去留。
const DEMO_USERS_COLUMNS = ["id", "name", "email", "role", "created_at"];

async function columnsOf(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY COLUMN_NAME`,
    [tableName]
  );

  return rows.map((row) => row.COLUMN_NAME);
}

async function dropDemoUsersTable(connection) {
  const existing = await columnsOf(connection, "users");

  if (existing.length === 0) {
    return;
  }

  const isDemoTable =
    existing.length === DEMO_USERS_COLUMNS.length &&
    [...DEMO_USERS_COLUMNS].sort().every((column, index) => column === existing[index]);

  if (!isDemoTable) {
    throw new Error(
      "Refusing to replace the existing users table: its columns are " +
        `[${existing.join(", ")}], which does not match the init.sql demo table ` +
        `[${DEMO_USERS_COLUMNS.join(", ")}]. Back up and drop it manually, then re-run.`
    );
  }

  await connection.query("DROP TABLE users");
}

export async function up(connection) {
  // 這張示範表是 node_simple_crud_backend starter 留下的（name / email / role），
  // 沒有任何程式碼讀寫它。它必須先走，因為新的 users 表要用同一個名字，而
  // `CREATE TABLE IF NOT EXISTS` 碰到它只會靜默跳過——那正是這個 migration
  // 第一次執行時實際發生的事。
  await dropDemoUsersTable(connection);

  await connection.query(`
    CREATE TABLE users (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username              VARCHAR(190)    NOT NULL,
      -- 雜湊字串自帶演算法與參數（見 src/module/user/passwordHash.js），所以
      -- 調整成本參數不需要改這個欄位，也不需要重算既有密碼。
      password_hash         VARCHAR(255)    NOT NULL,
      display_name          VARCHAR(190)    NOT NULL DEFAULT '',
      -- active | disabled。停用的帳號不能登入，但保留資料與稽核關聯。
      status                VARCHAR(20)     NOT NULL DEFAULT 'active',
      -- 連續登入失敗次數，成功登入後歸零。
      failed_login_attempts INT UNSIGNED    NOT NULL DEFAULT 0,
      -- 鎖定到期時間（epoch 毫秒）。NULL 代表未鎖定。
      locked_until          BIGINT UNSIGNED NULL,
      created_at            BIGINT UNSIGNED NOT NULL,
      updated_at            BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      -- 登入路徑唯一會用到的查詢就是照 username 找人，所以這個索引同時是唯一性
      -- 保證與查詢索引。
      UNIQUE KEY uq_users_username (username)
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name        VARCHAR(190)    NOT NULL,
      description VARCHAR(255)    NOT NULL DEFAULT '',
      created_at  BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_roles_name (name)
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name        VARCHAR(190)    NOT NULL,
      description VARCHAR(255)    NOT NULL DEFAULT '',
      created_at  BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_permissions_name (name)
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id BIGINT UNSIGNED NOT NULL,
      role_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (user_id, role_id),
      KEY idx_user_roles_role (role_id),
      -- 刪使用者或角色時一併清掉關聯；沒有級聯的話這裡會留下指向不存在 id 的
      -- 列，而登入時的 join 會安靜地少算權限。
      CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id       BIGINT UNSIGNED NOT NULL,
      permission_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      KEY idx_role_permissions_permission (permission_id),
      CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE,
      CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions (id) ON DELETE CASCADE
    )
  `);
}
