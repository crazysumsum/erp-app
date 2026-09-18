import { httpClient } from "@/framework/http/HttpClient.js";

export const service = { name: "supplierSettings" };

export default {
  get() {
    return httpClient.get("/api/v1/supplier-settings");
  },

  /**
   * 設計 §6.7：寫入設定同 Bank／封鎖同一個認證強度，所以 `signed: true`——
   * 後端係 `jwt-device-password`，要已核准裝置加密碼。
   */
  update(payload) {
    return httpClient.post("/api/v1/supplier-settings/update", { body: payload, signed: true });
  },

  /**
   * Business Master 係 provider，Supplier 只讀。呢條係 Supplier 自己嘅 lookup
   * （HD-022），唔係直接叫 Business Master 嘅 endpoint。
   */
  businessMasterReadiness() {
    return httpClient.get("/api/v1/supplier-lookups/business-master");
  }
};
