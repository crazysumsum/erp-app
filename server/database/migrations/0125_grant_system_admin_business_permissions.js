export async function up(connection) {
  // Fix the grant list at this release so future catalogue entries need their own decision.
  await connection.query(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON p.name IN (
        'inventory.view', 'inventory.operation', 'inventory.mgmt', 'inventory.adjust', 'inventory.fefo.override',
        'sales.view', 'sales.mgmt', 'sales.operation', 'sales.import',
        'fulfillment.view', 'fulfillment.operation', 'fulfillment.reverse',
        'purchasing.view', 'purchasing.mgmt', 'purchasing.approval', 'purchasing.settings',
        'receiving.operation', 'receiving.expiry.override',
        'ar.view', 'ar.invoice.mgmt', 'ar.receipt.mgmt'
      )
     WHERE r.name = 'system-admin'
    ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id
  `);
}
