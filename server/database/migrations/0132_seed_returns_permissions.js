const PERMISSIONS = [
  { name: "returns.view", description: "查看客戶退貨及退回供應商單據" },
  { name: "returns.customer.mgmt", description: "建立、取消及過帳客戶退貨" },
  { name: "returns.supplier.mgmt", description: "建立、取消及過帳退回供應商" }
];

export async function up(connection) {
  for (const { name, description } of PERMISSIONS) {
    await connection.execute(
      "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = permissions.name",
      [name, description, Date.now()]
    );
  }
  await connection.query(
    `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (?, ?, ?)
       WHERE r.name = 'system-admin'
     ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id`,
    PERMISSIONS.map(permission => permission.name)
  );
}
