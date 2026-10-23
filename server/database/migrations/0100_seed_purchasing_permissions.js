// Purchasing & Receiving permissions. The catalogue is authoritative; this migration is
// its immutable, idempotent database projection and grants no roles — not even System
// Administrator, which must be assigned the permissions explicitly.
//
// 0088 through 0099 are claimed by in-flight sales-archive and fulfillment branches, so
// this takes 0100. The runner keys applied state by full filename, and a permission seed
// is order-independent, so the gap costs nothing.
const PERMISSIONS = [
  { name: "purchasing.view", description: "查看採購單、收貨單、數量、金額及來源歷史" },
  { name: "purchasing.mgmt", description: "管理採購單草稿、提交、撤回、取消及關閉未收數量" },
  { name: "purchasing.approval", description: "審批指定給自己的採購單" },
  { name: "purchasing.settings", description: "管理採購模組參數" },
  { name: "receiving.operation", description: "建立及確認收貨單" },
  { name: "receiving.expiry.override", description: "在剩餘效期不足時以原因批准收貨例外" }
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
