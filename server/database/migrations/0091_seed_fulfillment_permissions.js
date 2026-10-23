// New permissions are independent; existing0063 retains fulfillment.operation.
const PERMISSIONS = [
  { name: "fulfillment.view", description: "查看履約、出貨及歷史資料" },
  { name: "fulfillment.reverse", description: "沖銷已確認出貨" }
];

export async function up(connection) {
  for (const permission of PERMISSIONS) {
    const [existing] = await connection.query("SELECT id FROM permissions WHERE name = ?", [permission.name]);
    if (existing.length === 0) {
      await connection.execute("INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)",
        [permission.name, permission.description, Date.now()]);
    }
  }
}
