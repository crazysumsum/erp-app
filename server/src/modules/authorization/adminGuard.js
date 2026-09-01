import { ApplicationError } from "../../framework/errors/ApplicationError.js";

/**
 * 提權防護：四道。設計說明見 docs/user-management.md §1.4。
 *
 * `user.mgmt` 與 `role.mgmt` 本身就有能力製造更高的權限——一個只有 `user.mgmt`
 * 的人，可以把 `system-admin` 指派給自己，一步拿齊全部權限。「`system-admin`
 * 角色不可改」擋不住這件事：角色不能改，不代表這個角色不能被指派給別人。
 *
 * 這裡全部是**純函式**：它們要的東西（操作者現在的權限、目標的角色、這次要
 * 授予什麼）全部由呼叫端查好傳進去，這裡只回答「可不可以」。這樣每一條規則都
 * 測得動，不必先架一個資料庫——而這幾條規則正是最需要窮舉邊界的地方（自己
 * 授給自己、最後一個 admin、空集合、超集合）。真正的資料庫查詢（讀操作者現在
 * 的權限、算最後一個 admin 是不是自己）住在 UserAdminService／RoleAdminService。
 */

export const SYSTEM_ADMIN_ROLE = "system-admin";

function conflict(message, { code, publicMessage }) {
  return new ApplicationError(message, {
    code,
    statusCode: 409,
    publicCode: code,
    publicMessage
  });
}

function forbidden(message, { code, publicMessage, details }) {
  return new ApplicationError(message, {
    code,
    statusCode: 403,
    publicCode: code,
    publicMessage,
    details
  });
}

/**
 * 第一道：`system-admin` 角色不可改不可刪。
 *
 * 角色管理的所有寫入路徑（改名、改描述、刪除、配權限）第一件事就是呼叫這個。
 * 它持有的權限清單同樣只由 migration 改——這條規則與 §1.3 的「`permissions`
 * 表唯讀」是同一類保護，只是保護的對象換成了這一個角色。
 */
export function assertRoleNotProtected(roleName) {
  if (roleName === SYSTEM_ADMIN_ROLE) {
    throw conflict(`Refusing to modify the protected role "${SYSTEM_ADMIN_ROLE}"`, {
      code: "ROLE_PROTECTED",
      publicMessage: "此角色受保護，無法修改或刪除"
    });
  }
}

/**
 * 第二道的第一步：算出這次操作會讓對方**新增**哪些權限。
 *
 * 只回傳新增的部分，不回傳移除的：一個 `user.mgmt` 管理員應該有能力把某個人
 * 的角色全部拔掉（那是降權，不是提權），即使那個角色帶著他自己沒有的權限。
 */
export function newlyGrantedPermissions(currentPermissionNames, nextPermissionNames) {
  const current = new Set(currentPermissionNames);
  return [...new Set(nextPermissionNames)].filter((permission) => !current.has(permission));
}

/**
 * 第二道的第二步：新增的權限集合必須是操作者自己權限集合的子集。
 *
 * 對 `system-admin` 自然成立：他持有全部三個權限，所以什麼都授得出去。對只有
 * `user.mgmt` 的人，效果是他只能指派「權限集合 ⊆ {user.mgmt}」的角色——
 * `system-admin` 帶著另外兩個權限，於是指派不出去，包括指派給自己。
 */
export function assertNoPermissionEscalation({ actorPermissions, grantedPermissions }) {
  const actor = new Set(actorPermissions);
  const disallowed = grantedPermissions.filter((permission) => !actor.has(permission));

  if (disallowed.length > 0) {
    throw forbidden(
      `Granting ${disallowed.join(", ")} would exceed the actor's own permissions`,
      {
        code: "PERMISSION_ESCALATION_DENIED",
        publicMessage: "無法授予您自己沒有的權限",
        details: { permissions: disallowed }
      }
    );
  }
}

/**
 * 第三道：最後一個 `system-admin` 不能被停用，也不能被移除角色。
 *
 * `otherActiveAdminCount` 由呼叫端查好傳進來——查詢本身必須用一句能與寫入
 * 一起原子化的 SQL（見 UserAdminService 的停用實作），這裡只負責邊界判斷本身：
 * 目標現在是不是 admin、改完之後還是不是、除了他自己還有沒有別的 active admin。
 *
 * 只有「現在是、改完不是、而且沒有別人」三者同時成立才算違規——這正是為什麼不能
 * 簡化成「檢查 nextRoleNames 有沒有 system-admin」：一個從來就不是 admin 的人，
 * 他的角色清單不含 system-admin 是正常狀態，不該觸發保護。
 */
export function wouldRemoveLastActiveAdmin({
  currentRoleNames,
  nextRoleNames,
  otherActiveAdminCount
}) {
  const currentlyAdmin = currentRoleNames.includes(SYSTEM_ADMIN_ROLE);
  const staysAdmin = nextRoleNames.includes(SYSTEM_ADMIN_ROLE);

  if (!currentlyAdmin || staysAdmin) {
    return false;
  }

  return otherActiveAdminCount === 0;
}

/** 匯出成獨立函式，讓需要直接丟這個錯誤的呼叫端（例如停用端點極窄的競態
 * 分支）不必為了同一個錯誤再組一次訊息。 */
export function lastAdminProtectedError() {
  return conflict("This change would leave the system with no active system-admin", {
    code: "LAST_ADMIN_PROTECTED",
    publicMessage: "系統至少需要保留一位可用的系統管理員"
  });
}

export function assertLastActiveAdminPreserved(input) {
  if (wouldRemoveLastActiveAdmin(input)) {
    throw lastAdminProtectedError();
  }
}

/**
 * 第四道：操作者現在的角色與權限，是不是還跟簽發 token 時一樣。
 *
 * `hasPermission` 授權策略讀的是 JWT claims，那是簽發當下的快照，最舊可以是
 * 15 分鐘前的（§1.5）。管理類端點要求即時生效，所以呼叫端在動作前重讀操作者
 * 現在的角色與權限，這裡只負責比較——順序不重要，比較的是集合。
 */
export function assertPermissionsCurrent({ claimedRoles, claimedPermissions, currentRoles, currentPermissions }) {
  const sameSet = (a, b) => {
    const setA = new Set(a);
    const setB = new Set(b);
    return setA.size === setB.size && [...setA].every((value) => setB.has(value));
  };

  if (!sameSet(claimedRoles, currentRoles) || !sameSet(claimedPermissions, currentPermissions)) {
    throw forbidden("The actor's roles or permissions changed since this token was issued", {
      code: "PERMISSION_STALE",
      publicMessage: "權限已變更，請重新整理"
    });
  }
}
