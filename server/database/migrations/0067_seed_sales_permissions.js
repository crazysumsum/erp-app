// Sales permissions are deliberately not granted by role name. The catalogue is
// authoritative; this migration is its immutable, idempotent database projection.
const PERMISSIONS = [
  { name: "sales.view", description: "查看報價、銷售訂單及匯出" },
  { name: "sales.mgmt", description: "管理報價、銷售訂單與確認操作" },
  { name: "sales.import", description: "匯入銷售訂單及管理外部接單" }
];

export async function up(connection) {
  const nowMs = Date.now();

  for (const permission of PERMISSIONS) {
    const [existing] = await connection.query(
      "SELECT id FROM permissions WHERE name = ?",
      [permission.name]
    );
    if (existing.length === 0) {
      await connection.execute(
        "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)",
        [permission.name, permission.description, nowMs]
      );
    }
  }
}
