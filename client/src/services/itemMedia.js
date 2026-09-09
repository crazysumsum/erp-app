import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "itemMedia" };

/**
 * Item／SKU media 的上傳、下載、update、delete API。路徑同回應形狀見
 * docs/items_management/design_spec.md §6.6。
 *
 * 上傳一律用 `FormData`，唔手動組 multipart body 或者設 Content-Type——
 * `HttpClient.request()` 見到 `body instanceof FormData` 會原樣交俾
 * `fetch()`，由瀏覽器自己生成正確嘅 boundary（見 HttpClient.js 的說明）。
 * `isPrimary`／`sortOrder`／`version` 呢幾個非檔案欄位喺 multipart 底下
 * 一律要係字串（後端 uploadMiddleware.js 只識收字串欄位），呢度負責轉，
 * 拒絕含糊嘅 boolean（`String(Boolean(x))` 一定係 `"true"`／`"false"`
 * 其中一個，唔會出現任意 truthy 字串）。
 */
function mediaFormData({ kind, isPrimary, sortOrder, version, file }) {
  const data = new FormData();
  data.append("kind", kind);
  if (isPrimary !== undefined) {
    data.append("isPrimary", String(Boolean(isPrimary)));
  }
  if (sortOrder !== undefined) {
    data.append("sortOrder", String(sortOrder));
  }
  data.append("version", String(version));
  data.append("file", file);
  return data;
}

export default {
  uploadItemMedia({ itemId, kind, isPrimary, sortOrder, version, file, signal }) {
    return httpClient.post(`/api/v1/items/${itemId}/media/upload`, {
      body: mediaFormData({ kind, isPrimary, sortOrder, version, file }),
      signal
    });
  },

  uploadSkuMedia({ skuId, kind, isPrimary, sortOrder, version, file, signal }) {
    return httpClient.post(`/api/v1/skus/${skuId}/media/upload`, {
      body: mediaFormData({ kind, isPrimary, sortOrder, version, file }),
      signal
    });
  },

  /** 回 `{ blob, contentType }`，唔係 URL——認證用 Authorization header，
   * `<img src>`／`<a href>` 冚唔到自訂 header，一定要先攞到 blob 先可以用
   * `URL.createObjectURL()` 顯示或者觸發下載（見 HttpClient.getBlob() 的
   * 說明）。 */
  downloadMedia(mediaId, { signal } = {}) {
    return httpClient.getBlob(`/api/v1/item-media/${mediaId}/download`, { signal });
  },

  /** 只接受 display name／sort order／primary；冇 version（呢張表冇呢個
   * 欄，見 server 端 design_spec §5.11 嘅說明）。淨係送有提供嘅欄位，等
   * 後端嘅「保留未提供嘅欄位」邏輯生效。 */
  updateMedia(mediaId, { displayName, sortOrder, isPrimary } = {}) {
    const body = {};
    if (displayName !== undefined) {
      body.displayName = displayName;
    }
    if (sortOrder !== undefined) {
      body.sortOrder = sortOrder;
    }
    if (isPrimary !== undefined) {
      body.isPrimary = isPrimary;
    }
    return httpClient.post(`/api/v1/item-media/${mediaId}/update`, { body });
  },

  deleteMedia(mediaId, { reason, password }) {
    return httpClient.post(`/api/v1/item-media/${mediaId}/delete`, { body: { reason, password } });
  }
};
