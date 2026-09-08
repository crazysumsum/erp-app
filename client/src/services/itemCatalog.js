import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "itemCatalog" };

/**
 * Category／Brand／UOM catalog 嘅 API。路徑同回應形狀集中喺呢度，見
 * docs/items_management/design_spec.md §6.4。Attribute 之後喺呢個檔案擴充。
 *
 * Category／UOM 唔分頁（`categoryTree()`／`uomList()` 直接回 items 陣列）；
 * Brand 分頁（`brandList()` 回 `{ rows, rowsNumber }`，同 services/user.js
 * 嘅 `list()` 同一個形狀，方便直接餵畀 DataTable 嘅 `fetch` prop）。
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
  },

  // --- Brand：分頁清單（同 Category／UOM 不同，見 §6.4） -----------------------

  brandList({ page, rowsPerPage, sortBy, descending, filter, status }) {
    return httpClient
      .get("/api/v1/catalog/brands", {
        params: {
          page,
          pageSize: rowsPerPage,
          q: filter || undefined,
          status: status || undefined,
          sortBy: sortBy || undefined,
          descending
        }
      })
      .then((result) => ({ rows: result.items, rowsNumber: result.total }));
  },

  createBrand({ name, officialName, description }) {
    return httpClient.post("/api/v1/catalog/brands/create", {
      body: { name, officialName: officialName ?? "", description: description ?? "" }
    });
  },

  updateBrand(id, { name, officialName, description, version }) {
    return httpClient.post(`/api/v1/catalog/brands/${id}/update`, {
      body: { name, officialName: officialName ?? "", description: description ?? "", version }
    });
  },

  activateBrand(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/brands/${id}/activate`, { body: { reason, version } });
  },

  deactivateBrand(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/brands/${id}/deactivate`, { body: { reason, version } });
  },

  archiveBrand(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/brands/${id}/archive`, { body: { reason, version, password } });
  },

  restoreBrand(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/brands/${id}/restore`, { body: { reason, version, password } });
  },

  deleteBrand(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/brands/${id}/delete`, { body: { reason, version, password } });
  },

  // --- UOM：不分頁小目錄（同 Category 一樣，見 §6.4） --------------------------

  async uomList({ includeArchived = false } = {}) {
    const { items } = await httpClient.get("/api/v1/catalog/uoms", {
      params: { includeArchived: includeArchived ? "true" : undefined }
    });
    return items;
  },

  createUom({ code, name, symbol }) {
    return httpClient.post("/api/v1/catalog/uoms/create", {
      body: { code, name, symbol: symbol ?? "" }
    });
  },

  /** 不接受修改 code——建立後即穩定，換代碼要走封存＋新建。 */
  updateUom(id, { name, symbol, version }) {
    return httpClient.post(`/api/v1/catalog/uoms/${id}/update`, {
      body: { name, symbol: symbol ?? "", version }
    });
  },

  activateUom(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/uoms/${id}/activate`, { body: { reason, version } });
  },

  deactivateUom(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/uoms/${id}/deactivate`, { body: { reason, version } });
  },

  archiveUom(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/uoms/${id}/archive`, { body: { reason, version, password } });
  },

  restoreUom(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/uoms/${id}/restore`, { body: { reason, version, password } });
  },

  deleteUom(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/uoms/${id}/delete`, { body: { reason, version, password } });
  },

  // --- Attribute：分頁清單（同 Brand 一樣，見 §6.4） -----------------------------

  attributeList({ page, rowsPerPage, sortBy, descending, filter, status, dataType }) {
    return httpClient
      .get("/api/v1/catalog/attributes", {
        params: {
          page,
          pageSize: rowsPerPage,
          q: filter || undefined,
          status: status || undefined,
          dataType: dataType || undefined,
          sortBy: sortBy || undefined,
          descending
        }
      })
      .then((result) => ({ rows: result.items, rowsNumber: result.total }));
  },

  createAttribute({ code, name, dataType, uomId, isVariant, isFilterable, options }) {
    return httpClient.post("/api/v1/catalog/attributes/create", {
      body: {
        code,
        name,
        dataType,
        uomId: uomId ?? null,
        isVariant: !!isVariant,
        isFilterable: !!isFilterable,
        options: options ?? []
      }
    });
  },

  /** 唔接受 code／dataType——同 UOM code 一樣建立後不可改；options 係原子
   * 覆蓋整個集合，帶 `id` 嘅代表保留（改內容），冇 `id` 代表新增。 */
  updateAttribute(id, { name, uomId, isVariant, isFilterable, options, version }) {
    return httpClient.post(`/api/v1/catalog/attributes/${id}/update`, {
      body: { name, uomId: uomId ?? null, isVariant: !!isVariant, isFilterable: !!isFilterable, options: options ?? [], version }
    });
  },

  activateAttribute(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/attributes/${id}/activate`, { body: { reason, version } });
  },

  deactivateAttribute(id, { reason, version }) {
    return httpClient.post(`/api/v1/catalog/attributes/${id}/deactivate`, { body: { reason, version } });
  },

  archiveAttribute(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/attributes/${id}/archive`, { body: { reason, version, password } });
  },

  restoreAttribute(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/attributes/${id}/restore`, { body: { reason, version, password } });
  },

  deleteAttribute(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/catalog/attributes/${id}/delete`, { body: { reason, version, password } });
  },

  // --- Category attribute assignment（獨立端點，理由見 categoryHandlers.js） ----

  getCategoryAttributes(categoryId) {
    return httpClient.get(`/api/v1/catalog/categories/${categoryId}/attributes`);
  },

  assignCategoryAttributes(categoryId, { assignments, expectedAttributeIds }) {
    return httpClient.post(`/api/v1/catalog/categories/${categoryId}/attributes/assign`, {
      body: { assignments, expectedAttributeIds }
    });
  }
};
