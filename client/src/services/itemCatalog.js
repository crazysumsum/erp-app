import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "itemCatalog" };

/**
 * Category（分類）catalog 嘅 API。路徑同回應形狀集中喺呢度，見
 * docs/items_management/design_spec.md §6.4。Brand／UOM／Attribute 之後喺
 * 呢個檔案擴充（T06 起）。
 *
 * `archive`／`restore`／`delete` 要求 authType "jwt-password"，body 帶
 * `password` 就夠，唔使簽章——同 services/role.js 嘅 `delete` 同一個理由
 * （呢幾個操作淨係斷存取／收返存取，唔係製造新嘅存取）。`create`／`update`／
 * `activate`／`deactivate` 淨係一般 jwt。
 */
export default {
  /** 整棵分類樹；`includeArchived` 預設 false（FR-DELETE-005）。 */
  async categoryTree({ includeArchived = false } = {}) {
    const { items } = await httpClient.get("/api/v1/catalog/categories", {
      params: { includeArchived: includeArchived ? "true" : undefined }
    });
    return items;
  },

  createCategory({ name, parentId, sortOrder }) {
    return httpClient.post("/api/v1/catalog/categories/create", {
      body: { name, parentId: parentId ?? null, sortOrder: sortOrder ?? 0 }
    });
  },

  /** 整組覆蓋（改名稱／排序／移動父層），compare-and-set。 */
  updateCategory(id, { name, parentId, sortOrder, version }) {
    return httpClient.post(`/api/v1/catalog/categories/${id}/update`, {
      body: { name, parentId: parentId ?? null, sortOrder, version }
    });
  },

  activateCategory(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/categories/${id}/activate`, {
      body: { reason, version }
    });
  },

  deactivateCategory(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/categories/${id}/deactivate`, {
      body: { reason, version }
    });
  },

  archiveCategory(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/categories/${id}/archive`, {
      body: { reason, version, password }
    });
  },

  restoreCategory(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/categories/${id}/restore`, {
      body: { reason, version, password }
    });
  },

  deleteCategory(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/categories/${id}/delete`, {
      body: { reason, version, password }
    });
  }
};
