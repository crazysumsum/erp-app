// 種入 Customer Management 權限。權限目錄的正本在
// src/modules/authorization/permissionCatalogue.js；這份 migration 保留自己的歷史
// 快照，不能 import 目前的目錄，否則新版本的目錄會改變舊資料庫的 migration 行為。

const SYSTEM_ADMIN_ROLE = "system-admin";

const PERMISSIONS = [
  { name: "customer.view", description: "查看客戶一般資料與變更歷史", grantToSystemAdmin: true },
  { name: "customer.mgmt", description: "管理客戶一般、信用及主資料", grantToSystemAdmin: true },
  { name: "customer.approval", description: "審批客戶啟用及封鎖狀態", grantToSystemAdmin: true },
  { name: "customer.bank.view", description: "主動查看客戶完整銀行資料及敏感附件", grantToSystemAdmin: false },
  { name: "customer.bank.mgmt", description: "管理客戶銀行資料及敏感附件", grantToSystemAdmin: false },
  { name: "customer.settings", description: "管理客戶設定及受控分類目錄", grantToSystemAdmin: true }
];

async function ensureRow(connection, { table, name, description, nowMs }) {
  const [existing] = await connection.query(`SELECT id FROM ${table} WHERE name = ?`, [name]);

  if (existing.length > 0) {
    return Number(existing[0].id);
  }

  const [result] = await connection.execute(
    `INSERT INTO ${table} (name, description, created_at) VALUES (?, ?, ?)`,
    [name, description, nowMs]
  );

  return Number(result.insertId);
}

export async function up(connection) {
  const nowMs = Date.now();
  const roleId = await ensureRow(connection, {
    table: "roles",
    name: SYSTEM_ADMIN_ROLE,
    description: "System Admin",
    nowMs
  });

  for (const permission of PERMISSIONS) {
    const permissionId = await ensureRow(connection, { ...permission, table: "permissions", nowMs });

    if (!permission.grantToSystemAdmin) {
      continue;
    }

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
}
