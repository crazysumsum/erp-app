// AP r5：固定本次批准的權限及 system-admin 授權，重跑不改動已存在的權限。
const PERMISSIONS = [
  { name: "ap.view", description: "查看應付發票、付款、核銷及帳齡表" },
  { name: "ap.invoice.mgmt", description: "建立、修改、確認、取消及作廢應付發票" },
  { name: "ap.payment.mgmt", description: "登記、確認、取消及作廢付款，核銷及解除核銷" },
  { name: "ap.invoice.price.override", description: "以原因調整應付發票收貨行金額" }
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
      FROM roles r JOIN permissions p ON p.name IN (?, ?, ?, ?)
     WHERE r.name = 'system-admin'
    ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id
  `, PERMISSIONS.map(({ name }) => name));
}
