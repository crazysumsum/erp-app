import { BaseRequestHandler } from "../../framework/api/BaseRequestHandler.js";
import { SupplierBankCrypto } from "../../modules/supplier/SupplierBankCrypto.js";
import { SupplierBankService } from "../../modules/supplier/SupplierBankService.js";
import {
  BANK_ACCOUNT_PARAMS_SCHEMA,
  BANK_CREATE_SCHEMA,
  BANK_LIST_RESPONSE_SCHEMA,
  BANK_REVEAL_POLICY,
  BANK_REVEAL_RESPONSE_SCHEMA,
  BANK_REVEAL_SCHEMA,
  BANK_UPDATE_SCHEMA,
  BANK_VERSIONED_SCHEMA,
  BANK_VIEW_POLICY,
  BANK_WRITE_POLICY,
  EMPTY_BANK_SCHEMA,
  MASKED_BANK_WITH_WARNINGS_SCHEMA,
  SUPPLIER_ID_PARAMS_SCHEMA
} from "./supplierBankSchemas.js";

/**
 * Bank 嘅 HTTP 層。規則全部喺 `SupplierBankService`；呢度只做四件事：定認證強度同
 * permission、關死 request／response 嘅形狀、將 route 參數交落去、同埋喺 reveal 上面
 * 加 no-store headers。
 *
 * ## 呢個檔案存在，就係 Bank capability 已經部署
 *
 * Handler 喺 startup 即刻構造（`framework/api/handlerRegistry.js`），而
 * `SupplierBankService` 冇 `SupplierBankCrypto` 就起唔到，`SupplierBankCrypto` 冇兩組
 * key ring 亦都起唔到。所以一個缺 key 嘅環境會喺 **startup** 死，唔會起到一半然後
 * 淨係 bank endpoint 壞。
 *
 * 呢個係設計 §1700 明文要求嘅：「Bank capability 已部署但缺 key 時應用 startup fail
 * closed，**不允許只關閉 bank endpoint 後照常啟動**，否則付款流程會在更晚時才失敗。」
 * 即係話下面個 constructor 冇 try／catch 唔係疏忽，佢就係嗰條規則 —— 加一個
 * 「攞唔到 key 就唔註冊 bank route」嘅後備路徑會直接違反佢。
 *
 * Product Owner 2026-09-21 按 HD-030 批准咗呢個部署，連埋 CI 同本機注入測試用 key。
 */

function actor(req) {
  return {
    actorId: Number(req.auth.claims.sub),
    claimedRoles: req.auth.claims.roles,
    claimedPermissions: req.auth.claims.permissions
  };
}

function command(req) {
  return {
    // Body 擺**最前**，框架嗰啲擺後面，所以一個叫 `actorId`／`requestId`／`ip`／
    // `supplierId` 嘅 body 欄位蓋唔到佢哋。今日冇 body 進得到呢度（五個 schema 都係
    // `additionalProperties: false` 而且冇宣告呢啲名），但呢條 route 寫緊銀行嘅稽核
    // 記錄 —— 稽核記錄入面邊個係「呼叫者講嘅」、邊個係「框架量到嘅」唔應該靠另一個
    // 檔案嘅一行 schema 嚟分。同 `supplierApprovalWithdrawHandler.js:48` 同一個考慮。
    ...req.input.body,
    ...actor(req),
    supplierId: Number(req.input.params.id),
    // 唔喺 params 嘅 route（create、list）冇 bankAccountId，所以唔可以無條件 Number()
    // 一個 undefined —— 嗰個會變 NaN，而一個 NaN 落到 SQL 係一個查唔到嘢嘅查詢，
    // 而唔係一個清楚嘅錯誤。
    ...(req.input.params.bankAccountId === undefined
      ? {}
      : { bankAccountId: Number(req.input.params.bankAccountId) }),
    requestId: req.requestId,
    ip: req.ip || req.socket?.remoteAddress || ""
  };
}

class SupplierBankHandler extends BaseRequestHandler {
  constructor(services = {}) {
    super(services);
    // `services.config` 就係 handler 攞設定嘅做法（見 handlers/catalog/*、
    // handlers/items/itemMediaUploadHandler.js）。`config.supplier` 已經由
    // applicationConfiguration 經 normalizeSupplierConfig 驗過同正規化。
    const supplier = services.config.supplier;
    this.banks = new SupplierBankService({
      database: services.require("mysqldatabase"),
      logger: services.require("logging").logger,
      time: services.require("time"),
      // 冇後備路徑，見上面。缺 key 就喺呢度死，而嗰個就係要嘅行為。
      crypto: new SupplierBankCrypto({
        encryption: supplier.bankEncryption,
        lookup: supplier.bankLookup
      })
    });
  }
}

export class ListSupplierBankAccountsHandler extends SupplierBankHandler {
  static handlerName = "listSupplierBankAccounts";

  static api = {
    method: "GET",
    path: "/api/v1/suppliers/:id/bank-accounts",
    description: "取得供應商的遮罩銀行帳戶清單。",
    // AC-023：所有 supplier.view 持有人都攞得到遮罩清單；bank.view 唔會自動 reveal。
    authorizationPolicies: BANK_VIEW_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_BANK_SCHEMA, body: EMPTY_BANK_SCHEMA },
    responseSchema: { 200: BANK_LIST_RESPONSE_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.banks.list({ ...actor(req), supplierId: Number(req.input.params.id) }));
  }
}

export class CreateSupplierBankAccountHandler extends SupplierBankHandler {
  static handlerName = "createSupplierBankAccount";

  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/bank-accounts/create",
    description: "新增供應商銀行帳戶，加密帳號並記錄稽核。",
    authType: "jwt-device-password",
    authorizationPolicies: BANK_WRITE_POLICY,
    requestSchema: { params: SUPPLIER_ID_PARAMS_SCHEMA, query: EMPTY_BANK_SCHEMA, body: BANK_CREATE_SCHEMA },
    responseSchema: { 200: MASKED_BANK_WITH_WARNINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.banks.create(command(req)));
  }
}

export class UpdateSupplierBankAccountHandler extends SupplierBankHandler {
  static handlerName = "updateSupplierBankAccount";

  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/update",
    description: "修改銀行帳戶；帳號有變更才重新加密。",
    authType: "jwt-device-password",
    authorizationPolicies: BANK_WRITE_POLICY,
    requestSchema: { params: BANK_ACCOUNT_PARAMS_SCHEMA, query: EMPTY_BANK_SCHEMA, body: BANK_UPDATE_SCHEMA },
    responseSchema: { 200: MASKED_BANK_WITH_WARNINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.banks.update(command(req)));
  }
}

export class SetDefaultSupplierBankAccountHandler extends SupplierBankHandler {
  static handlerName = "setDefaultSupplierBankAccount";

  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/default",
    description: "在同一交易內切換唯一的預設銀行帳戶。",
    authType: "jwt-device-password",
    authorizationPolicies: BANK_WRITE_POLICY,
    requestSchema: { params: BANK_ACCOUNT_PARAMS_SCHEMA, query: EMPTY_BANK_SCHEMA, body: BANK_VERSIONED_SCHEMA },
    responseSchema: { 200: MASKED_BANK_WITH_WARNINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.banks.setDefault(command(req)));
  }
}

export class DeactivateSupplierBankAccountHandler extends SupplierBankHandler {
  static handlerName = "deactivateSupplierBankAccount";

  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/deactivate",
    description: "停用銀行帳戶並清除預設；已引用的帳戶仍然保留。",
    authType: "jwt-device-password",
    authorizationPolicies: BANK_WRITE_POLICY,
    requestSchema: { params: BANK_ACCOUNT_PARAMS_SCHEMA, query: EMPTY_BANK_SCHEMA, body: BANK_VERSIONED_SCHEMA },
    responseSchema: { 200: MASKED_BANK_WITH_WARNINGS_SCHEMA }
  };

  async execute(req) {
    return this.response(await this.banks.deactivate(command(req)));
  }
}

export class RevealSupplierBankAccountHandler extends SupplierBankHandler {
  static handlerName = "revealSupplierBankAccount";

  static api = {
    method: "POST",
    path: "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal",
    description: "解密並回傳完整帳號，同時記錄查看稽核。",
    // 設計 §6.6：reveal 係 jwt-password，唔係 device-password —— 佢係一個讀取動作，
    // 而 device binding 係為咗寫入。要求同一個人重新輸入密碼，已經係「主動查看」
    // 嗰個門檻。
    authType: "jwt-password",
    authorizationPolicies: BANK_REVEAL_POLICY,
    requestSchema: { params: BANK_ACCOUNT_PARAMS_SCHEMA, query: EMPTY_BANK_SCHEMA, body: BANK_REVEAL_SCHEMA },
    responseSchema: { 200: BANK_REVEAL_RESPONSE_SCHEMA }
  };

  /**
   * T34 個驗收條件寫住 reveal 要回 `Cache-Control: no-store, private`。**`private`
   * 去唔到線上**，而呢度冇扮佢去到：`sendSuccess` 第一句就係
   * `res.setHeader("Cache-Control", "no-store")`（`framework/http/apiResponse.js:21`，
   * 錯誤路徑 `:46` 一樣），而 `setHeader` 係覆寫唔係附加，所以任何喺呢度設嘅
   * `Cache-Control` 都會喺送出之前被抹走。REV-039 喺真 HTTP 上量到實際值係
   * `no-store`。
   *
   * 呢個驗收條件因此**未達成**，而 Product Owner 2026-09-21 揀咗記錄偏離而唔係改框架：
   * `no-store` 本身已經禁止任何快取（共用或私有）儲存個 response（RFC 9111 §5.2.2.5），
   * 所以 `private` 喺實際安全上加唔到嘢，而為咗一個 token 去改一個**所有**模組都經
   * 嘅 response 路徑，代價同收益唔成比例。偏離記錄喺 00_harness_state.json
   * （DEV-T34-CACHE-PRIVATE）同實作報告。要真係達成，要改嘅係 `apiResponse.js`
   * 令佢唔好覆寫一個已經更窄嘅 `Cache-Control` —— 嗰個喺本模組 allowed_write_paths 以外。
   *
   * `Pragma: no-cache` 就真係設得到 —— 框架唔掂佢 —— 所以佢留低：係俾只識 HTTP/1.0
   * 快取語意嘅中間件，今日好少，但一個公司內部嘅舊 proxy 就係最有可能坐喺呢條 route
   * 前面嗰種嘢。同 `handlers/user/loginHandler.js` 設 `Retry-After` 係同一個做法。
   */
  async execute(req, res) {
    res.setHeader("Pragma", "no-cache");
    return this.response(await this.banks.reveal(command(req)));
  }
}
