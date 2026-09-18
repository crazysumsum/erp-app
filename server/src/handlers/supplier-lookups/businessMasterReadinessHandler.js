import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { BusinessMasterProvider } from "../../modules/businessMaster/BusinessMasterProvider.js";
import { BusinessMasterReadinessService } from "../../modules/businessMaster/BusinessMasterReadinessService.js";

/**
 * Supplier 自己嘅 Business Master readiness lookup。
 *
 * 點解唔直接叫 `/api/v1/business-master/currencies`：Business Master 設計 DES-001
 * 明文講 consumer-facing selector endpoint 由各 consumer handler 用自己嘅 permission
 * 授權，rationale 就係唔好喺一個 generic lookup handler 度硬編所有未來 consumer role；
 * DES-012 仲記錄咗 Supplier 原本嗰個 generic HTTP lookup 已經改成 own-permission
 * handler + internal provider。實際上嗰邊 VIEW_POLICY 亦都係六條 route 共用，入面
 * 包住 Business Master 稽核記錄 —— 放寬佢會連稽核一齊派街。決定記錄喺 HD-022。
 *
 * 呢度**唔**用 BusinessMasterLookupProvider.assertReady()：佢唔 READY 就拋 503，
 * 而呢條 route 嘅工作正正係報告 NOT_READY 畀設定頁顯示，唔係自己死。
 */

const EMPTY = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

// Settings 頁係唯一 caller，所以權限同設定頁一致。設計 §4.3：permission catalogue
// 冇隱式繼承，所以呢度唔可以假設 supplier.settings 持有人順手有 supplier.view。
const SUPPLIER_SETTINGS_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.settings"]) })
})]);

const READINESS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["status", "providerContract", "schemaReady", "hkdReady", "permissionsReady", "activeCurrencyCount", "activePaymentTermCount"],
  properties: {
    status: { type: "string", enum: ["READY", "NOT_READY"] },
    providerContract: { type: "string" },
    // 三個分項唔係裝飾：NOT_READY 嘅時候管理員要知係差 schema、差 HKD seed 定差權限，
    // 先至知去搵邊個。
    schemaReady: { type: "boolean" },
    hkdReady: { type: "boolean" },
    permissionsReady: { type: "boolean" },
    activeCurrencyCount: { type: "integer", minimum: 0 },
    activePaymentTermCount: { type: "integer", minimum: 0 }
  }
});

export class GetSupplierBusinessMasterReadinessHandler extends BaseRequestHandler {
  static handlerName = "getSupplierBusinessMasterReadiness";

  static api = {
    method: "GET",
    path: "/api/v1/supplier-lookups/business-master",
    description: "回報 Business Master provider 對供應商模組的就緒狀態，供設定頁顯示唯讀依賴狀態。",
    authorizationPolicies: SUPPLIER_SETTINGS_POLICY,
    requestSchema: { params: EMPTY, query: EMPTY, body: EMPTY },
    responseSchema: { 200: READINESS_SCHEMA }
  };

  constructor(services = {}) {
    super(services);
    this.readiness = new BusinessMasterReadinessService({
      database: services.require("mysqldatabase"),
      checkerIds: ["supplier"]
    });
  }

  /**
   * REV-028 M-2：inspect() 喺計 schemaReady 之前就已經無條件查 currencies 同
   * payment_terms，冇 try。所以「張表根本未建」—— schemaReady 變 false 最常見嗰個
   * 原因 —— 實際上會出 ER_NO_SUCH_TABLE 變成 500，設定頁永遠顯示唔到
   * 「資料表尚未建立或版本不符」。呢個 service 喺 Supplier 嘅寫入範圍外，改唔到，
   * 所以喺呢度處理。
   *
   * 只捉「表唔存在」呢一種：嗰種情況下 schema 就係真係未 ready，報告佢係如實。
   * 其他錯誤（連線斷、逾時、權限）照拋 —— 嗰啲情況我哋根本唔知 provider 就唔就緒，
   * 報一個 NOT_READY 出去係講一個我哋未證實嘅嘢。
   */
  async inspect() {
    try {
      return await this.readiness.inspect();
    } catch (error) {
      if (error?.code !== "ER_NO_SUCH_TABLE" && error?.errno !== 1146) throw error;
      return {
        status: "NOT_READY",
        providerContract: BusinessMasterProvider.contract,
        schemaReady: false,
        hkdReady: false,
        permissionsReady: false,
        activeCurrencyCount: 0,
        activePaymentTermCount: 0
      };
    }
  }

  async execute() {
    const result = await this.inspect();
    // 白名單投影：inspect() 仲回 checkerIds，嗰個係 server 內部組裝細節，唔關設定頁事。
    return this.response({
      status: result.status,
      providerContract: result.providerContract,
      schemaReady: result.schemaReady,
      hkdReady: result.hkdReady,
      permissionsReady: result.permissionsReady,
      activeCurrencyCount: result.activeCurrencyCount,
      activePaymentTermCount: result.activePaymentTermCount
    });
  }
}
