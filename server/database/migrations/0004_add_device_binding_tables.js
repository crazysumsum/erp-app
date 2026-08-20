// 設備綁定認證所需的資料表與種子資料。設計說明見 docs/device-binding-auth.md。
//
// 沒有 fr_ 前綴，而是 user_ 前綴：審批流程、誰有權審批、組織要不要管制設備，
// 這些是業務政策而不是框架機制，與 users / roles / permissions 同一類。框架
// 自己的 fr_token_versions 刻意用 subject VARCHAR(190) 且不設外鍵以保持通用，
// 這兩張表反過來，直接對 users 設外鍵。
//
// 時間一律存 epoch 毫秒（BIGINT UNSIGNED），與 0003_add_auth_tables.js 及
// time service 的 nowMs() 一致。
//
// 寫成 JS 而不是 SQL 的理由是下半段的種子資料：角色與權限的種入必須是「有就
// 跳過、沒有就新增」，那需要先查再寫。

const SYSTEM_ADMIN_ROLE = "system-admin";
const DEVICE_APPROVE_PERMISSION = "device.approve";

async function createTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id       BIGINT UNSIGNED NOT NULL,
      -- 公鑰的 SHA-256 thumbprint（hex）。不是前端自選的隨機數：自選 ID 多一個
      -- 可偽造的輸入卻換不到任何好處，而 thumbprint 只有持有私鑰的人用得了。
      device_id     CHAR(64)        NOT NULL,
      -- SPKI DER 格式的公鑰。目前用 ECDSA P-256，約 91 bytes。宣告 512 是給
      -- 日後換演算法的餘裕（RSA-2048 的 SPKI 約 294 bytes，塞不進 255）——
      -- VARBINARY 是變長型別，宣告得寬不會多佔任何儲存空間。
      public_key    VARBINARY(512)  NOT NULL,
      -- 使用者自填的裝置名稱，例如「Sam 的辦公室桌機」。審批者要靠它做判斷：
      -- 一組 thumbprint 加一串公鑰對人類毫無意義，沒有這欄審批只會退化成
      -- 無腦按核准。
      label         VARCHAR(190)    NOT NULL DEFAULT '',
      -- pending | approved | rejected | revoked
      status        VARCHAR(20)     NOT NULL DEFAULT 'pending',
      requested_at  BIGINT UNSIGNED NOT NULL,
      -- 申請當下的 IP 與 UA，同樣是給審批者看的判斷依據。
      requested_ip  VARCHAR(45)     NOT NULL DEFAULT '',
      requested_ua  VARCHAR(255)    NOT NULL DEFAULT '',
      reviewed_at   BIGINT UNSIGNED NULL,
      reviewed_by   BIGINT UNSIGNED NULL,
      review_note   VARCHAR(190)    NOT NULL DEFAULT '',
      -- 最後一次成功用這台設備登入或續期的時間。續期每 15 分鐘更新一次，所以
      -- 使用中的設備永遠不會變舊。NULL 代表從未成功使用過（還在 pending、被拒，
      -- 或核准了但使用者再也沒回來）。清理工作照 status 分三條規則處理這一欄與
      -- requested_at、reviewed_at 的關係。
      last_used_at  BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      -- 同一把金鑰可以被不同使用者各自申請（共用電腦的正常情況），所以唯一性是
      -- (user_id, device_id) 而不是 device_id：「批准 Sam 用這台機器」與「批准
      -- 這台機器」是兩件不同的授權。
      UNIQUE KEY uq_user_devices_user_device (user_id, device_id),
      -- 審批佇列：撈出所有 pending 並照申請時間排序。
      KEY idx_user_devices_status (status, requested_at),
      -- 使用者的設備清單，以及清理工作第三條規則的掃描。
      KEY idx_user_devices_last_used (last_used_at),
      CONSTRAINT fk_user_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      -- 審批者離職被刪除時保留這筆綁定記錄，只是不知道是誰批的，所以 SET NULL
      -- 而不是 CASCADE——CASCADE 會連帶刪掉一堆仍然有效的設備綁定。
      CONSTRAINT fk_user_devices_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);

  // 防簽章重放：客戶端每次簽名帶一個 UUID，這裡 INSERT，主鍵衝突就是重放。
  //
  // 這張表不含任何使用者資料，user_device_ 前綴純粹是為了讓設備認證的兩張表在
  // schema 裡排在一起、一眼看得出是同一個功能的。
  //
  // 表的大小有界：只保留簽章時效窗內的列，由 deviceBinding.purgeNonces 刪除。
  await connection.query(`
    CREATE TABLE IF NOT EXISTS user_device_nonces (
      nonce      CHAR(36)        NOT NULL,
      expires_at BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (nonce),
      KEY idx_user_device_nonces_expires (expires_at)
    )
  `);
}

/**
 * 照名稱種入一列，已存在就跳過，回傳它的 id。
 *
 * 刻意用「先查再寫」而不是 INSERT IGNORE：後者會把所有錯誤一起降級成警告，
 * 包含型別不符、欄位缺失這些真正該中止 migration 的問題。這裡只跑一次，
 * 多一次 SELECT 沒有成本。
 */
async function ensureRow(connection, { table, name, description, nowMs }) {
  const [existing] = await connection.query(
    `SELECT id FROM ${table} WHERE name = ?`,
    [name]
  );

  if (existing.length > 0) {
    return Number(existing[0].id);
  }

  const [result] = await connection.execute(
    `INSERT INTO ${table} (name, description, created_at) VALUES (?, ?, ?)`,
    [name, description, nowMs]
  );

  return Number(result.insertId);
}

async function seedRoleAndPermission(connection) {
  const nowMs = Date.now();

  // 刻意不指定 id，也不去碰 role_id = 1。
  //
  // roles 目前沒有任何種子資料——0003 只建表，現有環境裡的角色全部是
  // scripts/createUser.js 在 --role 時順手建出來的，所以 id 1 是什麼完全取決於
  // 誰先跑過那支腳本。以 id 當錨點去「改名」，在那些環境裡等於靜默改掉一個正在
  // 使用中的角色名，而角色名會出現在 JWT claims、hasRole 策略與前端頁面
  // metadata 裡——那些地方不會報錯，只會安靜地開始比對失敗。
  //
  // 改以名稱為準之後這個問題整個消失：乾淨的資料庫裡 system-admin 自然拿到
  // id 1，既有環境裡它拿到下一個可用的 id，兩邊都不需要人工介入。
  const roleId = await ensureRow(connection, {
    table: "roles",
    name: SYSTEM_ADMIN_ROLE,
    description: "System Admin",
    nowMs
  });

  const permissionId = await ensureRow(connection, {
    table: "permissions",
    name: DEVICE_APPROVE_PERMISSION,
    description: "審批設備綁定申請",
    nowMs
  });

  // system-admin 只給 device.approve 這一個權限，不預先塞其他的。日後要什麼再
  // 逐項加——一個上線第一天就握有所有權限的角色，之後沒有人敢動它。
  const [link] = await connection.query(
    "SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?",
    [roleId, permissionId]
  );

  if (link.length === 0) {
    await connection.execute(
      "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
      [roleId, permissionId]
    );
  }
}

export async function up(connection) {
  await createTables(connection);
  await seedRoleAndPermission(connection);
}
