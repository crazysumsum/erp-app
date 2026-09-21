// 種入 Supplier Management 的六項獨立權限，並授予受保護的 system-admin。
// migration 是不可變的歷史紀錄，因此刻意不 import 目前的 permission catalogue。

const SYSTEM_ADMIN_ROLE = "system-admin";

const PERMISSIONS = [
  { name: "supplier.view", description: "查看一般供應商資料與變更歷史" },
  { name: "supplier.mgmt", description: "管理供應商一般主資料與一般狀態" },
  { name: "supplier.approval", description: "審批供應商啟用及管理封鎖狀態" },
  { name: "supplier.bank.view", description: "查看供應商完整銀行資料" },
  { name: "supplier.bank.mgmt", description: "管理供應商銀行資料" },
  { name: "supplier.settings", description: "管理供應商模組參數" }
];

async function ensureRow(connection, { table, name, description, nowMs }) {
  const [existing] = await connection.query(
    `SELECT id FROM ${table} WHERE name = ?`,
    [name]
  );

  if (existing.length > 0) return Number(existing[0].id);

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
    const permissionId = await ensureRow(connection, {
      table: "permissions",
      ...permission,
      nowMs
    });
    const [existing] = await connection.query(
      "SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?",
      [roleId, permissionId]
    );
    if (existing.length === 0) {
      await connection.execute(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [roleId, permissionId]
      );
    }
  }
}
