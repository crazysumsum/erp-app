// 種入用戶／角色管理的權限，並授予 system-admin。設計說明見
// docs/user_management/design_spec.md §2.3。
//
// 權限目錄的正本在 src/modules/authorization/permissionCatalogue.js。這裡把那三項
// 再寫一次，而**不是** import 它——雖然抄一份看起來像是在製造第二個正本。
//
// 理由是 migration 是歷史紀錄，不是現在的程式碼。import 之後，任何人把那個檔案
// 改名、搬家、或刪掉一項，都會改變這一支 migration 在**全新資料庫**上的行為——
// 而 CI 每一輪都在跑那條路徑。抄一份換來的是這一支永遠只做它當初被寫下來時要做
// 的事。
//
// 兩份分岔的代價則有人接：啟動自檢（PermissionCatalogueService）會在缺項時直接
// 拒絕啟動，並指名缺哪一個。也就是說分岔不會安靜地發生——那正是可以接受重複的
// 條件。
//
// 完全沒有 DDL，所以是三支裡唯一一支天生「跑到一半失敗、重跑一定收斂」的：
// 每一步本身就是冪等的。
//
// device.approve → device.mgmt 的改名不在這裡，它是 Phase 0 獨立投產的
// 0005_rename_device_permission.js。

const SYSTEM_ADMIN_ROLE = "system-admin";

const PERMISSIONS = [
  { name: "user.mgmt", description: "管理用戶與用戶的角色" },
  { name: "role.mgmt", description: "管理角色與角色的權限" },
  // 正常路徑上這一項已經由 0005 改名改出來了，所以下面會走「已存在，跳過」那一
  // 邊。留著它是給「permissions 被人手動清過」的資料庫一條回得去的路——那正是
  // 啟動自檢會拒絕啟動的那個狀態。
  { name: "device.mgmt", description: "審批、拒絕或撤銷設備綁定申請" }
];

/**
 * 照名稱種入一列，已存在就跳過，回傳它的 id。
 *
 * 與 0004 的同名函式一樣是「先查再寫」而不是 INSERT IGNORE：後者會把所有錯誤
 * 一起降級成警告，包含型別不符、欄位缺失這些真正該中止 migration 的問題。
 *
 * 同樣沒有抽出去與 0004 共用，理由同上：一支 migration 要能單獨解釋自己。
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
