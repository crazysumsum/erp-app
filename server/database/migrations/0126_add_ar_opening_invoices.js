// P2-01. Sam approved work on a branch on 2026-11-23 (PM agentmsg 2c577ffe).
// The legacy reference length and company-wide key are provisional until Finance checks the cutoff list.
const REFERENCE_LENGTH = 50;
const ACTIVE_REFERENCE_KEY = ["active_opening_reference"];
const PERMISSION = { name: "ar.opening.mgmt", description: "登記期初發票" };

export async function up(connection) {
  for (const column of ["opening_reference", "active_opening_reference"]) {
    const [existing] = await connection.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'ar_invoices' AND column_name = ?", [column]);
    if (!existing.length) await connection.query(`ALTER TABLE ar_invoices ADD COLUMN ${column} VARCHAR(${REFERENCE_LENGTH}) NULL DEFAULT NULL`);
  }

  const [indexes] = await connection.query(`SELECT column_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'ar_invoices' AND index_name = 'uq_ar_invoice_active_opening_reference' ORDER BY seq_in_index`);
  if (!indexes.length) {
    await connection.query(`ALTER TABLE ar_invoices ADD UNIQUE KEY uq_ar_invoice_active_opening_reference (${ACTIVE_REFERENCE_KEY.join(", ")})`);
  }

  await connection.query(`INSERT INTO permissions (name, description, created_at) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE name = permissions.name`, [PERMISSION.name, PERMISSION.description, Date.now()]);
  await connection.query(`INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = ? WHERE r.name = 'system-admin'
    ON DUPLICATE KEY UPDATE permission_id = role_permissions.permission_id`, [PERMISSION.name]);
}
