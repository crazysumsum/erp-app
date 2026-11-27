// F-09. Keep the historical allowlist fixed even if the live permission catalogue changes.
export async function up(connection) {
  await connection.query(`
    DELETE rp FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE r.name = 'system-admin' AND p.name NOT IN (
       'user.mgmt', 'role.mgmt', 'device.mgmt', 'item.view', 'item.mgmt',
       'customer.view', 'customer.mgmt', 'customer.approval', 'customer.settings',
       'supplier.view', 'supplier.mgmt', 'supplier.approval', 'supplier.settings',
       'business_master.view', 'business_master.mgmt'
     )
  `);
}
