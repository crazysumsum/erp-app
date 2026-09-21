import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "item" };

/**
 * Item／SKU 的查詢及建立 API。路徑同回應形狀見
 * docs/items_management/design_spec.md §6.2、§6.3、§6.9。其餘寫入路徑
 * （修改、狀態變更）留到之後嘅 task 先接上，到時會喺呢個檔案繼續加方法——同
 * itemCatalog.js 一個檔案涵蓋 Category／Brand／UOM 全部操作是同一個理由。
 *
 * `listItems()`／`listSkus()` 回 `{ rows, rowsNumber }`，同 services/user.js
 * 的 `list()` 同一個形狀，方便直接餵畀 DataTable 的 `fetch` prop。
 */
export default {
  /** 對應 `POST /api/v1/items/create`。`sku`（單數）係 Standard Item 嘅
   * 簡便寫法，包成一個元素嘅陣列；T23 開放咗 `createItem()` 接受多個
   * SKU（Variant Item）之後，呼叫端可以直接傳 `skus`（複數，每個帶
   * `variantValues`）代替。兩者互斥，唔會同時傳。呢個 route 有
   * idempotency，`idempotent: true` 令 HttpClient 自動帶一個新
   * `Idempotency-Key`。 */
  createItem({ item, sku, skus, activate, activationReason }) {
    return httpClient.post("/api/v1/items/create", {
      idempotent: true,
      body: {
        item,
        skus: skus ?? [sku],
        ...(activate ? { activate: true, activationReason } : {})
      }
    });
  },


  listItems({ page, rowsPerPage, sortBy, descending, filter, categoryId, brandId, status, includeArchived }) {
    return httpClient
      .get("/api/v1/items", {
        params: {
          page,
          pageSize: rowsPerPage,
          q: filter || undefined,
          categoryId: categoryId || undefined,
          brandId: brandId || undefined,
          status: status || undefined,
          includeArchived,
          sortBy: sortBy || undefined,
          descending
        }
      })
      .then((result) => ({ rows: result.items, rowsNumber: result.total }));
  },

  getItem(id) {
    return httpClient.get(`/api/v1/items/${id}`);
  },

  /** 整組覆蓋（compare-and-set），對應 `POST /api/v1/items/:id/update`。冇
   * `productType`：呢期唔開放喺 Item 層面改變（同 createItem() 同一個
   * Standard-only 範圍限制）。 */
  updateItem(id, payload) {
    return httpClient.post(`/api/v1/items/${id}/update`, { body: payload });
  },

  listSkus({
    page,
    rowsPerPage,
    sortBy,
    descending,
    filter,
    itemId,
    categoryId,
    brandId,
    status,
    includeArchived,
    purchasable,
    sellable
  }) {
    return httpClient
      .get("/api/v1/skus", {
        params: {
          page,
          pageSize: rowsPerPage,
          q: filter || undefined,
          itemId: itemId || undefined,
          categoryId: categoryId || undefined,
          brandId: brandId || undefined,
          status: status || undefined,
          includeArchived,
          purchasable,
          sellable,
          sortBy: sortBy || undefined,
          descending
        }
      })
      .then((result) => ({ rows: result.items, rowsNumber: result.total }));
  },

  getSku(id) {
    return httpClient.get(`/api/v1/skus/${id}`);
  },

  /** 為既有 Variant Item 新增一個 Draft SKU。建立 command 使用 framework
   * idempotency，避免網路重送時重複建立同一個規格組合。 */
  createSku(payload) {
    return httpClient.post("/api/v1/skus/create", { idempotent: true, body: payload });
  },

  /** 整組覆蓋（compare-and-set，連 UOM／Barcode 完整集合一齊），對應
   * `POST /api/v1/skus/:id/update`。冇 `skuCode`：readonly，特批修改係
   * 獨立、未建嘅高強度端點；冇 `variantValues`（T23）。 */
  updateSku(id, payload) {
    return httpClient.post(`/api/v1/skus/${id}/update`, { body: payload });
  },

  // --- Item：生命週期（T18 後端，見 design_spec §6.2） -----------------------

  /** 帶 `skuIds` 一齊啟用指定嘅完整 SKU；Item 因而由 Draft／Inactive 轉
   * Active（已經 Active 嘅 Item 都可以再嚟啟用多幾個 SKU）。 */
  activateItem(id, { skuIds, reason, version }) {
    return httpClient.post(`/api/v1/items/${id}/activate`, {
      body: { skuIds, reason, version }
    });
  },

  deactivateItem(id, { reason, version }) {
    return httpClient.post(`/api/v1/items/${id}/deactivate`, {
      body: { reason, version }
    });
  },

  discontinueItem(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/items/${id}/discontinue`, {
      body: { reason, version, password }
    });
  },

  archiveItem(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/items/${id}/archive`, {
      body: { reason, version, password }
    });
  },

  restoreItem(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/items/${id}/restore`, {
      body: { reason, version, password }
    });
  },

  // --- SKU：生命週期（T18 後端，見 design_spec §6.3） ------------------------

  activateSku(id, { reason, version }) {
    return httpClient.post(`/api/v1/skus/${id}/activate`, {
      body: { reason, version }
    });
  },

  deactivateSku(id, { reason, version }) {
    return httpClient.post(`/api/v1/skus/${id}/deactivate`, {
      body: { reason, version }
    });
  },

  discontinueSku(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/skus/${id}/discontinue`, {
      body: { reason, version, password }
    });
  },

  archiveSku(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/skus/${id}/archive`, {
      body: { reason, version, password }
    });
  },

  restoreSku(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/skus/${id}/restore`, {
      body: { reason, version, password }
    });
  },

  // --- Item／SKU：高風險操作（T20，見 design_spec §6.2、§6.3） ---------------

  deleteItem(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/items/${id}/delete`, {
      body: { reason, version, password }
    });
  },

  /** 複製成新 Draft；`skus` 係 `[{ sourceSkuId, skuCode }]`，唔複製條碼。呢個
   * route 有 idempotency，`idempotent: true` 令 HttpClient 自動帶一個新
   * `Idempotency-Key`（同 `createItem()` 一樣）。 */
  copyItem(id, { skus }) {
    return httpClient.post(`/api/v1/items/${id}/copy`, {
      idempotent: true,
      body: { skus }
    });
  },

  deleteSku(id, { reason, version, password }) {
    return httpClient.post(`/api/v1/skus/${id}/delete`, {
      body: { reason, version, password }
    });
  },

  /** 後端 authType 係 `jwt-device-password`，同 user.js 嘅 `create`／
   * `assignRoles`／`resetPassword` 一樣要 `signed: true`——HttpClient 先會
   * 幫個 request 加設備簽章 header，唔係就算密碼啱都會俾伺服器拒絕
   * （DEVICE_SIGNATURE_REQUIRED）。 */
  changeSkuCode(id, { skuCode, reason, version, password }) {
    return httpClient.post(`/api/v1/skus/${id}/code/change`, {
      body: { skuCode, reason, version, password },
      signed: true
    });
  },

  releaseBarcode(id, barcodeId, { reason, version, password }) {
    return httpClient.post(`/api/v1/skus/${id}/barcodes/${barcodeId}/release`, {
      body: { reason, version, password },
      signed: true
    });
  },

  /** 建立 Item 之前嘅疑似重複提示（Phase 3）。只警告，唔阻擋建立，所以呢個
   * 唔使 idempotency——重複撳只係重新查一次，冇副作用。 */
  checkDuplicates({ name, categoryId, brandId, signal }) {
    return httpClient.post("/api/v1/items/duplicates/check", { body: { name, categoryId, brandId }, signal });
  },

  /** 最多 100 筆 Item／SKU 的全有全無批量狀態變更（Phase 3）。`targets` 係
   * `[{ id, version }]`；高風險操作，用 password signing，唔係一般
   * request——同單筆 discontinue／archive／restore 一致。 */
  bulkChangeStatus({ targetType, action, targets, reason, password }) {
    return httpClient.post("/api/v1/item-bulk/status/change", {
      body: { targetType, action, targets, reason, password }
    });
  }
};
