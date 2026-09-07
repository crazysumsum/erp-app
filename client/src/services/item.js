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
  /** 對應 `POST /api/v1/items/create`——T14 只做 Standard Item（一個 Item
   * 一個 SKU），呢度嘅參數形狀跟返嗰個限制，唔接受 `variantValues`。呢個
   * route 有 idempotency，`idempotent: true` 令 HttpClient 自動帶一個新
   * `Idempotency-Key`。 */
  createItem({ item, sku, activate, activationReason }) {
    return httpClient.post("/api/v1/items/create", {
      idempotent: true,
      body: {
        item,
        skus: [sku],
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
  }
};
