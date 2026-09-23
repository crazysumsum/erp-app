// Inventory permissions are deliberately not granted by role name. The catalogue is
// authoritative; this migration is its immutable, idempotent database projection.
const PERMISSIONS = [
  { name: "inventory.view", description: "查看庫存、批次、異動及匯出" },
  { name: "inventory.operation", description: "執行一般庫存、預留、調撥及盤點操作" },
  { name: "inventory.mgmt", description: "管理倉庫、庫位、期初庫存及上線" },
  { name: "inventory.adjust", description: "執行庫存調整、狀態轉移、沖銷及盤點過帳" },
  { name: "inventory.fefo.override", description: "在仍符合庫存資格時偏離 FEFO 揀貨次序" }
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
