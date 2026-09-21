import { SUPPLIER_ID_PARAMS_SCHEMA } from "./supplierSchemas.js";

/**
 * Bank API 嘅 static metadata。設計說明見
 * docs/supplier_management/03_design_spec.md §6.6、§7.4，同 01_requirement_spec.md
 * FR-BANK-001～007、AC-023～AC-026。
 *
 * 呢個檔案最重要嘅性質係：**冇一個 response schema 講得出帳號或者 crypto metadata**，
 * 而每個 schema 都 `additionalProperties: false`。即係就算 service 有一日開始多回一個
 * 欄位，佢都出唔到 HTTP —— response validation 會攔住佢。呢個係 SEC-006／FR-BANK-007
 * 嘅結構性防線，唔係靠每個 handler 記得投影。
 */

export const EMPTY_BANK_SCHEMA = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

export { SUPPLIER_ID_PARAMS_SCHEMA };

export const BANK_ACCOUNT_PARAMS_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "bankAccountId"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[1-9][0-9]{0,18}$" },
    bankAccountId: { type: "string", pattern: "^[1-9][0-9]{0,18}$" }
  }
});

/**
 * 設計 §6.6／AC-023：**所有人**只由 GET 攞到遮罩清單，`bank.view` 唔會自動 reveal。
 * 所以呢條係三個 policy 入面最闊嗰個 —— 得 `supplier.view`。
 */
export const BANK_VIEW_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.view"]) })
})]);

/**
 * 設計 §6.6：reveal 要 `supplier.view` ＋ `supplier.bank.view`。留意佢**唔要求**
 * `bank.mgmt` —— 睇同改係兩件事，一個只可以睇嘅稽核人員唔應該因為要睇而攞埋改嘅權。
 */
export const BANK_REVEAL_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({ permissions: Object.freeze(["supplier.view", "supplier.bank.view"]) })
})]);

/**
 * 設計 §6.6：寫入要三個一齊有。`match` 保持預設（all）。
 *
 * 點解寫入都要 `bank.view`：一個改得到但睇唔到嘅人，改完之後核對唔到自己改咗乜，
 * 而遮罩清單本身就係佢唯一嘅反饋。設計 §7.4 個權限矩陣亦都係咁畫。
 */
export const BANK_WRITE_POLICY = Object.freeze([Object.freeze({
  name: "hasPermission",
  options: Object.freeze({
    permissions: Object.freeze(["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"])
  })
})]);

const REASON_SCHEMA = Object.freeze({ type: "string", minLength: 5, maxLength: 500 });

/**
 * 每條 step-up route 嘅 body 都要**明文宣告** `password`。
 *
 * `passwordReauth.js` 喺 schema 驗證**之前**由 `req.body.password` 讀佢，所以一個冇
 * 宣告佢嘅 schema 唔會令個密碼消失 —— 佢會令個請求喺驗證嗰層死喺
 * `additionalProperties: false` 上面，而個錯誤會係一個講唔通嘅 400。同
 * `approvalSchemas.js` 同 `supplierSchemas.js` 嘅做法一致。
 */
const PASSWORD_SCHEMA = Object.freeze({ type: "string", minLength: 1, maxLength: 1024 });

// 帳號本身。`minLength: 1` 淨係擋空字串；真正嘅字元規則喺
// SupplierBankCrypto.bankAccountRejection，由 service 拋一個帶 field 嘅 400。
// 唔喺 AJV 度寫 pattern，係因為嗰條規則有 NFC、全形折疊同排版剝除三步，
// 一個 JSON Schema pattern 表達唔到，而寫一個近似嘅版本就會同 service 講唔同嘢。
const ACCOUNT_NUMBER_SCHEMA = Object.freeze({ type: "string", minLength: 1, maxLength: 2048 });

const BANK_DETAIL_PROPERTIES = Object.freeze({
  accountHolderName: { type: "string", minLength: 1, maxLength: 190 },
  bankName: { type: "string", minLength: 1, maxLength: 190 },
  bankCountryCode: { type: "string", pattern: "^[A-Za-z]{2}$" },
  bankCode: { type: "string", maxLength: 50 },
  branchCode: { type: "string", maxLength: 50 },
  swiftBic: { type: "string", maxLength: 11 },
  accountCurrencyCode: { type: "string", pattern: "^[A-Za-z]{3}$" }
});

export const BANK_CREATE_SCHEMA = Object.freeze({
  type: "object",
  required: ["accountHolderName", "bankName", "accountNumber", "reason", "password"],
  additionalProperties: false,
  properties: {
    ...BANK_DETAIL_PROPERTIES,
    accountNumber: ACCOUNT_NUMBER_SCHEMA,
    isDefault: { type: "boolean", default: false },
    reason: REASON_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});

export const BANK_UPDATE_SCHEMA = Object.freeze({
  type: "object",
  required: ["accountHolderName", "bankName", "version", "reason", "password"],
  additionalProperties: false,
  properties: {
    ...BANK_DETAIL_PROPERTIES,
    // 設計 §6.6：帳號有改先重新加密。冇帶就係「唔改帳號」。
    accountNumber: ACCOUNT_NUMBER_SCHEMA,
    version: { type: "integer", minimum: 1 },
    reason: REASON_SCHEMA,
    password: PASSWORD_SCHEMA
  }
});

export const BANK_VERSIONED_SCHEMA = Object.freeze({
  type: "object",
  required: ["version", "reason", "password"],
  additionalProperties: false,
  properties: { version: { type: "integer", minimum: 1 }, reason: REASON_SCHEMA, password: PASSWORD_SCHEMA }
});

export const BANK_REVEAL_SCHEMA = Object.freeze({
  type: "object",
  required: ["reason", "password"],
  additionalProperties: false,
  properties: { reason: REASON_SCHEMA, password: PASSWORD_SCHEMA }
});

/**
 * 遮罩投影。**冇** accountNumber、冇 ciphertext／iv／authTag／blindIndex，亦都冇兩個
 * key ID —— key ID 唔係機密，但佢會講出邊行用緊邊條 key，即係縮窄咗一個攻擊者要試
 * 嘅範圍，而 UI 一個用途都冇。
 */
export const MASKED_BANK_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "bankName", "accountHolderName", "maskedAccountNumber", "status", "isDefault", "version"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    supplierId: { type: "integer", minimum: 1 },
    bankName: { type: "string" },
    accountHolderName: { type: "string" },
    bankCountryCode: { type: ["string", "null"] },
    accountCurrencyCode: { type: ["string", "null"] },
    maskedAccountNumber: { type: "string" },
    status: { type: "string", enum: ["active", "inactive"] },
    isDefault: { type: "boolean" },
    version: { type: "integer", minimum: 1 },
    updatedAt: { type: "integer", minimum: 0 }
  }
});

/**
 * 設計 §6.6：跨 Supplier 嘅重覆只回一個 warning，而佢**唔可以**回對方嘅帳號。
 * `supplierCodes` 係空陣列（冇 supplier.view）或者對方嘅 Supplier Code，俾人手判斷。
 */
const BANK_WARNING_SCHEMA = Object.freeze({
  type: "object",
  required: ["code", "message", "supplierCodes"],
  additionalProperties: false,
  properties: {
    code: { type: "string", enum: ["BANK_ACCOUNT_DUPLICATE_OTHER_SUPPLIER"] },
    message: { type: "string" },
    supplierCodes: { type: "array", items: { type: "string" } }
  }
});

export const MASKED_BANK_WITH_WARNINGS_SCHEMA = Object.freeze({
  ...MASKED_BANK_SCHEMA,
  properties: Object.freeze({
    ...MASKED_BANK_SCHEMA.properties,
    warnings: { type: "array", items: BANK_WARNING_SCHEMA }
  })
});

export const BANK_LIST_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["items"],
  additionalProperties: false,
  properties: { items: { type: "array", items: MASKED_BANK_SCHEMA } }
});

/**
 * Reveal 係唯一一個講得出帳號嘅 response，所以佢係唯一一個需要收窄 cache header 嘅 route。
 *
 * 但實際過到線嘅淨係 `no-store`（框架加）同 `Pragma: no-cache`（handler 加）。驗收條件
 * 寫嘅 `no-store, private` 入面個 `private` **去唔到線** —— `sendSuccess` 會喺 handler
 * 之後覆寫 `Cache-Control`。呢個係一個批咗嘅偏離，記錄喺 00_harness_state.json 一條
 * subject 叫「DEV-T34-CACHE-PRIVATE: the reveal route's Cache-Control acceptance criterion
 * is not met」嘅 observation，理由喺 supplierBankHandlers.js 個 reveal handler 度寫齊。
 *
 * 設計 §6.6 個範例仲有 `expiresInSeconds`。呢度**冇**做：嗰個數字暗示伺服器會過期
 * 一啲嘢，但實際上冇任何 server-side 狀態同佢對應 —— 明文淨係活喺呢一個 response
 * 入面。一個講緊一件冇發生嘅事嘅欄位，比冇嗰個欄位更差。UI 自己幾時清 component
 * memory 係 T35 嘅事，唔需要伺服器俾個數字佢。呢個偏離記錄喺 00_harness_state.json 一條
 * subject 叫「DEV-T34-EXPIRES-IN: design 6.6's reveal response includes expiresInSeconds and
 * the implementation omits it」嘅 observation，同實作報告 §5。
 */
export const BANK_REVEAL_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["id", "accountNumber", "revealedAt"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", minimum: 1 },
    accountNumber: { type: "string" },
    revealedAt: { type: "integer", minimum: 0 }
  }
});
