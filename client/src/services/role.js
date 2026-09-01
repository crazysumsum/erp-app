import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "role" };

/**
 * 角色與權限目錄嘅 API。路徑同回應形狀集中喺呢度，見
 * docs/user-management.md §3.1。
 *
 * `assignPermissions` 要求 authType "jwt-device-password"（見
 * services/user.js 開頭嗰段解釋），其餘寫入動作用返 jwt-password 或者
 * 完全唔使再確認密碼（新增角色、改名稱／描述——做完之後冇任何人多得到
 * 或少得到任何一項存取，見 §5.2）。
 */
export default {
  /** 全部角色，含權限名同持有人數，唔分頁（角色數量本身就少，見 §3.3）。 */
  async list() {
    const { items } = await httpClient.get("/api/v1/roles");
    return items;
  },

  create({ name, description }) {
    return httpClient.post("/api/v1/roles/create", { body: { name, description } });
  },

  update(id, { name, description }) {
    return httpClient.post(`/api/v1/roles/${id}/update`, { body: { name, description } });
  },

  delete(id, { reason, password }) {
    return httpClient.post(`/api/v1/roles/${id}/delete`, { body: { reason, password } });
  },

  /** 整組覆蓋角色嘅權限（compare-and-set）。 */
  assignPermissions(id, { permissionIds, expectedPermissionIds, reason, password }) {
    return httpClient.post(`/api/v1/roles/${id}/permissions/assign`, {
      body: { permissionIds, expectedPermissionIds, reason, password },
      signed: true
    });
  },

  /** 權限目錄，唯讀——配置權限對話框嘅勾選清單來源。 */
  async listPermissions() {
    const { items } = await httpClient.get("/api/v1/permissions");
    return items;
  }
};
