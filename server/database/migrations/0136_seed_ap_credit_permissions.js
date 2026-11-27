const PERMISSIONS = [
  { name: "ap.credit.mgmt", description: "管理應付貸項單及核銷" },
  { name: "ap.refund.mgmt", description: "管理供應商退款" }
];

export async function up(connection) {
  const now = Date.now();
  for (const { name, description } of PERMISSIONS) {
    await connection.execute(
      "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = permissions.name",
      [name, description, now]
    );
  }

  await connection.execute(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM roles r JOIN permissions p ON p.name IN (?, ?)
     WHERE r.name = 'system-admin'
    ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id
  `, PERMISSIONS.map(({ name }) => name));
}
