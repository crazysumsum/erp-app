// 種入 Item Management 的權限，並授予 system-admin。設計說明見
// docs/items_management/design_spec.md §3.1。
//
// 權限目錄的正本在 src/modules/authorization/permissionCatalogue.js。這裡把那兩項
// 再寫一次，而**不是** import 它——理由與 0008 相同：migration 是歷史紀錄，不是
// 現在的程式碼，import 會讓這一支 migration 在全新資料庫上的行為隨目錄檔案改變
// 而漂移。
//
// 編號從 0010 開始而不是設計文件最初寫的 0009：0009 已經被
// 0009_add_user_email.js 用掉，這裡不重用、不插隊，順延一位（見
// docs/items_management/tasks.md §1.2）。
//
// 全部沒有 DDL，跟 0008 一樣天生冪等：每一步本身都是「先查再寫」。

const SYSTEM_ADMIN_ROLE = "system-admin";

const PERMISSIONS = [
  { name: "item.view", description: "查看商品、SKU 與商品變更歷史" },
  { name: "item.mgmt", description: "管理商品、SKU 與商品主資料" }
];

/**
 * 照名稱種入一列，已存在就跳過，回傳它的 id。
 *
 * 與 0004、0008 的同名函式一樣是「先查再寫」而不是 INSERT IGNORE：後者會把
 * 所有錯誤一起降級成警告，包含型別不符、欄位缺失這些真正該中止 migration 的
 * 問題。同樣沒有抽出去共用：一支 migration 要能單獨解釋自己。
 */
async function ensureRow(connection, { table, name, description, nowMs }) {
  const [existing] = await connection.query(
    `SELECT id FROM ${table} WHERE name = ?`,
    [name]
  );

  if (existing.length > 0) {
    return Number(existing[0].id);
  }

  const [result] = await connection.execute(
    `INSERT INTO ${table} (name, description, created_at) VALUES (?, ?, ?)`,
    [name, description, nowMs]
  );

  return Number(result.insertId);
}

export async function up(connection) {
  const nowMs = Date.now();

  // 0004 已經種過 system-admin，這裡再確認一次而不是假設它在：這一支的正確性
  // 不該建立在「另一支跑過了」這個前提上。
  const roleId = await ensureRow(connection, {
    table: "roles",
    name: SYSTEM_ADMIN_ROLE,
    description: "System Admin",
    nowMs
  });

  for (const permission of PERMISSIONS) {
    const permissionId = await ensureRow(connection, {
      table: "permissions",
      name: permission.name,
      description: permission.description,
      nowMs
    });

    const [link] = await connection.query(
      "SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?",
      [roleId, permissionId]
    );

    if (link.length === 0) {
      await connection.execute(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [roleId, permissionId]
      );
    }
  }
}
