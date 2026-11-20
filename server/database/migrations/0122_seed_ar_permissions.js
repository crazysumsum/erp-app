// 開票與應收（AR）首期的三個權限。目錄（permissionCatalogue.js）是正本；這支 migration 是它在資料庫的
// 不可變、可重跑的投影，不授予任何角色（包括系統管理員），須由管理員在角色管理頁指派。
const PERMISSIONS = [
  { name: "ar.view", description: "查看發票、收款、核銷及帳齡表" },
  { name: "ar.invoice.mgmt", description: "由出貨建立、確認及作廢發票" },
  { name: "ar.receipt.mgmt", description: "登記、確認及作廢收款，核銷及解除核銷" }
];

export async function up(connection) {
  const nowMs = Date.now();

  for (const permission of PERMISSIONS) {
    const [existing] = await connection.query("SELECT id FROM permissions WHERE name = ?", [permission.name]);
    if (existing.length === 0) {
      await connection.execute("INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)",
        [permission.name, permission.description, nowMs]);
    }
  }
}
