// BILLING-SNAPSHOT.md r3 §1 (024e4ec0…39cb), approved by Sam on 2026-11-23.
// Existing documents have no historical billing address to copy.
export async function up(connection) {
  const [existing] = await connection.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'ar_invoices' AND column_name = 'billing_address_snapshot'`);
  if (existing.length === 0) {
    await connection.query("ALTER TABLE ar_invoices ADD COLUMN billing_address_snapshot VARCHAR(1200) NOT NULL DEFAULT ''");
  }
}
