import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplier" };

const LIST_FILTERS = Object.freeze([
  "status", "currencyCode", "paymentTermId", "missingPrimaryContact", "missingAddress", "missingBank", "includeArchived",
  "createdFrom", "createdTo", "updatedFrom", "updatedTo"
]);

// 空字串、null、false 都當「冇篩選」唔送：false 嘅 missing* 喺 API 係「唔缺」，唔係「唔篩」。
function listFilters(filters) {
  return Object.fromEntries(LIST_FILTERS
    .filter((name) => filters[name] !== undefined && filters[name] !== null && filters[name] !== "" && filters[name] !== false)
    .map((name) => [name, filters[name]]));
}

export default {
  create(payload) {
    return httpClient.post("/api/v1/suppliers/create", {
      idempotent: true,
      body: payload
    });
  },

  checkDuplicates(payload) {
    return httpClient.post("/api/v1/suppliers/duplicates/check", {
      body: payload
    });
  },

  /** `filters`：status、currencyCode、paymentTermId、missing*、includeArchived、created／updated 範圍（epoch ms）；空值唔送。 */
  list({ page, rowsPerPage, sortBy, descending, filter, ...filters }) {
    return httpClient.get("/api/v1/suppliers", {
      params: { page, pageSize: rowsPerPage, q: filter || undefined, ...listFilters(filters), sortBy: sortBy || undefined, descending }
    }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },

  /** 一般匯出（T47；HD-067）：同列表一樣嘅篩選同排序，要密碼確認；回 `{ blob, fileName }`。 */
  exportCsv({ filter, sortBy, descending, password, signal, ...filters }) {
    return httpClient.postBlob("/api/v1/supplier-exports", {
      body: { password, filters: { q: filter || undefined, ...listFilters(filters), sortBy: sortBy || undefined, descending } },
      signal
    });
  },

  /** 詳情最多帶 100 筆地址／聯絡人，之後用呢兩個分頁讀（HD-107 G5）。 */
  listAddresses(id, { page, pageSize }) {
    return httpClient.get(`/api/v1/suppliers/${id}/addresses`, { params: { page, pageSize } });
  },

  listContacts(id, { page, pageSize }) {
    return httpClient.get(`/api/v1/suppliers/${id}/contacts`, { params: { page, pageSize } });
  },

  getById(id) {
    return httpClient.get(`/api/v1/suppliers/${id}`);
  },

  completeness(id) {
    return httpClient.get(`/api/v1/suppliers/${id}/completeness`);
  },

  update(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/update`, { body: payload });
  },

  changeCode(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/code/change`, { body: payload, signed: true });
  },

  activate(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/activate`, { body: payload });
  },

  suspend(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/suspend`, { body: payload });
  },

  reactivate(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/reactivate`, { body: payload });
  },

  block(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/block`, { body: payload, signed: true });
  },

  unblock(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/unblock`, { body: payload, signed: true });
  },

  archive(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/archive`, { body: payload });
  },

  restore(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/restore`, { body: payload });
  },

  deleteSupplier(id, payload) {
    return httpClient.post(`/api/v1/suppliers/${id}/delete`, { body: payload, signed: true });
  },

  createAddress(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/create`, { body: payload });
  },

  updateAddress(supplierId, addressId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/${addressId}/update`, { body: payload });
  },

  deactivateAddress(supplierId, addressId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/addresses/${addressId}/deactivate`, { body: payload });
  },

  createContact(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/contacts/create`, { body: payload });
  },

  updateContact(supplierId, contactId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/contacts/${contactId}/update`, { body: payload });
  },

  deactivateContact(supplierId, contactId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/contacts/${contactId}/deactivate`, { body: payload });
  },

  createIdentifier(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/identifiers/create`, { body: payload });
  },

  updateIdentifier(supplierId, identifierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/identifiers/${identifierId}/update`, { body: payload });
  },

  deleteIdentifier(supplierId, identifierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/identifiers/${identifierId}/delete`, { body: payload });
  },

  /** 供貨關係（TASK-039）：轉做 DataTable 嘅 `{ rows, rowsNumber }`。 */
  listSkuRelations(supplierId, { page, rowsPerPage, filter }) {
    return httpClient.get(`/api/v1/suppliers/${supplierId}/sku-relations`, {
      params: { page, pageSize: rowsPerPage, q: filter || undefined }
    }).then(({ items, total }) => ({ rows: items, rowsNumber: total }));
  },

  createSkuRelation(supplierId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/sku-relations/create`, { body: payload });
  },

  updateSkuRelation(supplierId, relationId, payload) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/sku-relations/${relationId}/update`, { body: payload });
  },

  /** 只列而家可以採購嘅 SKU 同佢哋嘅單位（Item searchForPurchase）；帶 `skuId` 就精確攞嗰一隻。 */
  searchPurchasableSkus({ q, skuId, pageSize = 20, signal } = {}) {
    return httpClient.get("/api/v1/supplier-lookups/skus", { params: { q: q || undefined, skuId, pageSize }, signal });
  },

  /** 表單揀嘅 Active 幣別同付款條件：Supplier 自己嘅 lookup，supplier.view 就讀到（DEF-036、HD-126 A）。 */
  async currencyOptions() {
    return (await httpClient.get("/api/v1/supplier-lookups/currencies")).items;
  },

  async paymentTermOptions() {
    return (await httpClient.get("/api/v1/supplier-lookups/payment-terms")).items;
  }
};
