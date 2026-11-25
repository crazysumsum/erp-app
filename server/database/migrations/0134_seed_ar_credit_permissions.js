const PERMISSIONS = [
  { name: "ar.credit.mgmt", description: "管理應收貸項單及貸項核銷" },
  { name: "ar.refund.mgmt", description: "管理客戶退款記錄" }
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
       SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (?, ?)
       WHERE r.name = 'system-admin'
     ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id`,
    PERMISSIONS.map(({ name }) => name)
  );
}
