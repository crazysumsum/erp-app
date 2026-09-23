import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplierBank" };

/**
 * Bank API 嘅客戶端。路徑同認證強度集中喺呢度，唔散落喺 .vue 入面。
 *
 * ## 明文只行一個方向
 *
 * 帳號明文**淨係**出現喺兩個地方：寫入時 `body.accountNumber`，同 reveal 回來嗰個
 * response。呢度冇任何一個 method 會將佢放入 URL、query string 或者 header ——
 * 設計 §7.5 明文禁止，而 URL 會入瀏覽器紀錄、Referer 同伺服器 access log，三個
 * 都係我哋清唔到嘅地方。
 *
 * ## 認證強度要同伺服器對得上（設計 §6.6）
 *
 * 四條寫入係 `jwt-device-password`：`signed: true` 帶裝置簽章，body 帶 password。
 * Reveal 係 `jwt-password`：**唔簽**。呢個唔係疏忽 —— reveal 係讀取動作，而 device
 * binding 係為咗寫入。簽咗佢就等於要求一個伺服器冇要求嘅條件，會令一個只得
 * bank.view、部機未綁定嘅稽核人員睇唔到嘢。
 */
export default {
  /**
   * 遮罩清單。AC-023：所有 `supplier.view` 持有人都攞得到，`bank.view` 唔會令佢
   * 自動變明文。
   *
   * 要自己叫一次，唔可以靠 supplier detail：`toSupplierDetailResponse` 個
   * `bankAccounts` 有 default `[]` 而冇人填佢，所以 detail payload 嗰條係恒空。
   */
  async list(supplierId) {
    const { items } = await httpClient.get(`/api/v1/suppliers/${supplierId}/bank-accounts`);
    return items;
  },

  create(supplierId, body) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/bank-accounts/create`, { body, signed: true });
  },

  update(supplierId, bankAccountId, body) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/bank-accounts/${bankAccountId}/update`, { body, signed: true });
  },

  setDefault(supplierId, bankAccountId, body) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/bank-accounts/${bankAccountId}/default`, { body, signed: true });
  },

  deactivate(supplierId, bankAccountId, body) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/bank-accounts/${bankAccountId}/deactivate`, { body, signed: true });
  },

  /**
   * 唯一一條回明文嘅 route。回 `{ id, accountNumber, revealedAt }` —— **冇**
   * `expiresInSeconds`：伺服器冇任何 server-side 狀態同一個到期時間對應
   * （見 ledger 嘅 DEV-T34-EXPIRES-IN），所以幾時清明文係客戶端自己嘅責任，
   * 而個 30 秒喺 SupplierBankPanel 度。
   */
  reveal(supplierId, bankAccountId, body) {
    return httpClient.post(`/api/v1/suppliers/${supplierId}/bank-accounts/${bankAccountId}/reveal`, { body });
  }
};
