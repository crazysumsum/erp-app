import assert from "node:assert/strict";
import test from "node:test";

import * as schemas from "../src/handlers/suppliers/supplierBankSchemas.js";

import {
  CreateSupplierBankAccountHandler,
  DeactivateSupplierBankAccountHandler,
  ListSupplierBankAccountsHandler,
  RevealSupplierBankAccountHandler,
  SetDefaultSupplierBankAccountHandler,
  UpdateSupplierBankAccountHandler
} from "../src/handlers/suppliers/supplierBankHandlers.js";
import {
  BANK_CREATE_SCHEMA,
  BANK_LIST_RESPONSE_SCHEMA,
  BANK_REVEAL_RESPONSE_SCHEMA,
  BANK_REVEAL_SCHEMA,
  BANK_UPDATE_SCHEMA,
  BANK_VERSIONED_SCHEMA,
  MASKED_BANK_SCHEMA,
  MASKED_BANK_WITH_WARNINGS_SCHEMA
} from "../src/handlers/suppliers/supplierBankSchemas.js";

/**
 * 呢個檔案守住 HTTP contract 本身：邊條路徑、要幾強嘅認證、要邊幾個 permission、
 * body 收唔收得多嘅欄位、response 可以講出乜。Domain 規則喺 supplierBankService.test.js，
 * 真 SQL 同真 HTTP 喺 integration/supplierBank。
 */

const WRITE_HANDLERS = [
  CreateSupplierBankAccountHandler, UpdateSupplierBankAccountHandler,
  SetDefaultSupplierBankAccountHandler, DeactivateSupplierBankAccountHandler
];
const ALL_HANDLERS = [ListSupplierBankAccountsHandler, ...WRITE_HANDLERS, RevealSupplierBankAccountHandler];

function permissionsOf(Handler) {
  const [policy] = Handler.api.authorizationPolicies;
  return policy.options.permissions;
}

test("the Bank routes sit exactly where design 6.6 puts them", () => {
  assert.equal(ListSupplierBankAccountsHandler.api.path, "/api/v1/suppliers/:id/bank-accounts");
  assert.equal(CreateSupplierBankAccountHandler.api.path, "/api/v1/suppliers/:id/bank-accounts/create");
  assert.equal(UpdateSupplierBankAccountHandler.api.path, "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/update");
  assert.equal(SetDefaultSupplierBankAccountHandler.api.path, "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/default");
  assert.equal(DeactivateSupplierBankAccountHandler.api.path, "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/deactivate");
  assert.equal(RevealSupplierBankAccountHandler.api.path, "/api/v1/suppliers/:id/bank-accounts/:bankAccountId/reveal");
  assert.equal(ListSupplierBankAccountsHandler.api.method, "GET");
  for (const Handler of [...WRITE_HANDLERS, RevealSupplierBankAccountHandler]) {
    assert.equal(Handler.api.method, "POST", `${Handler.handlerName} must not be a GET`);
  }
});

test("the masked list is the widest route and reveal is a separate POST, not a flag on it", () => {
  // AC-023：所有人只由 GET 攞到遮罩清單；bank.view 唔會自動 reveal。如果 reveal 係
  // list 上面一個 query flag，一個「淨係想睇清單」嘅請求就有條路攞到明文。
  assert.deepEqual(permissionsOf(ListSupplierBankAccountsHandler), ["supplier.view"]);
  assert.deepEqual(ListSupplierBankAccountsHandler.api.requestSchema.query.properties, {},
    "the list route takes no query at all, so there is no reveal flag to find");
  assert.notEqual(RevealSupplierBankAccountHandler.api.path, ListSupplierBankAccountsHandler.api.path);
});

test("reveal demands view plus bank.view, and deliberately not bank.mgmt", () => {
  // 睇同改係兩件事。一個只可以睇嘅稽核人員唔應該因為要睇而攞埋改嘅權。
  assert.deepEqual(permissionsOf(RevealSupplierBankAccountHandler), ["supplier.view", "supplier.bank.view"]);
  assert.ok(!permissionsOf(RevealSupplierBankAccountHandler).includes("supplier.bank.mgmt"));
  assert.notEqual(RevealSupplierBankAccountHandler.api.authorizationPolicies[0].options.match, "any",
    "both permissions, not either of them");
});

test("every write demands all three permissions and a device password", () => {
  for (const Handler of WRITE_HANDLERS) {
    assert.deepEqual(permissionsOf(Handler),
      ["supplier.view", "supplier.bank.view", "supplier.bank.mgmt"], Handler.handlerName);
    assert.notEqual(Handler.api.authorizationPolicies[0].options.match, "any", Handler.handlerName);
    assert.equal(Handler.api.authType, "jwt-device-password", Handler.handlerName);
  }
  // 設計 §6.6：reveal 係 jwt-password，唔係 device-password —— 佢係讀取，而 device
  // binding 係為咗寫入。兩者唔可以互相漂移。
  assert.equal(RevealSupplierBankAccountHandler.api.authType, "jwt-password");
  assert.equal(ListSupplierBankAccountsHandler.api.authType, undefined, "a masked read needs no step-up");
});

test("no request schema accepts an unknown field, on any Bank route", () => {
  // SEC-005：一個開住 additionalProperties 嘅 body 係一條靜靜哋收新欄位嘅路。
  for (const Handler of ALL_HANDLERS) {
    for (const [part, schema] of Object.entries(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, `${Handler.handlerName}.${part}`);
    }
  }
});

test("no response schema can utter an account number or any crypto metadata", () => {
  // FR-BANK-007／SEC-006。呢個係結構性防線：就算 service 有一日開始多回一個欄位，
  // response validation 都會攔住佢，唔使靠每個 handler 記得投影。
  const forbidden = [
    "accountNumber", "accountCiphertext", "account_ciphertext", "accountIv", "account_iv",
    "authTag", "account_auth_tag", "blindIndex", "account_blind_index",
    "encryptionKeyId", "encryption_key_id", "blindIndexKeyId", "blind_index_key_id",
    "cryptoContext", "crypto_context", "lastFour", "last_four", "accountLength", "account_length"
  ];
  for (const schema of [MASKED_BANK_SCHEMA, MASKED_BANK_WITH_WARNINGS_SCHEMA, BANK_LIST_RESPONSE_SCHEMA]) {
    const serialized = JSON.stringify(schema);
    for (const name of forbidden) {
      assert.ok(!serialized.includes(`"${name}"`), `${name} must not be reachable through a masked response`);
    }
  }
  // Reveal 係唯一一個講得出帳號嘅 response，而佢淨係講得出三樣嘢。
  assert.deepEqual(Object.keys(BANK_REVEAL_RESPONSE_SCHEMA.properties).sort(),
    ["accountNumber", "id", "revealedAt"]);
  assert.equal(BANK_REVEAL_RESPONSE_SCHEMA.additionalProperties, false);
});

test("the reveal response is the only one that carries an account, and every other route's is closed", () => {
  for (const Handler of ALL_HANDLERS) {
    const schema = Handler.api.responseSchema[200];
    const carriesAccount = JSON.stringify(schema).includes('"accountNumber"');
    assert.equal(carriesAccount, Handler === RevealSupplierBankAccountHandler,
      `${Handler.handlerName} ${carriesAccount ? "must not" : "must"} be able to return an account number`);
  }
});

test("every step-up route declares password in its body schema", () => {
  // `passwordReauth.js` 喺 schema 驗證**之前**由 req.body.password 讀佢。一個冇宣告
  // 佢嘅 schema 唔會令個密碼消失 —— 佢會令成個請求死喺 additionalProperties: false
  // 上面，變成一個講唔通嘅 400。即係話少咗呢句，五條 step-up route 全部用唔到，而
  // 上面每一個宣告式斷言都仍然係綠嘅。
  for (const Handler of [...WRITE_HANDLERS, RevealSupplierBankAccountHandler]) {
    const body = Handler.api.requestSchema.body;
    assert.ok(body.required.includes("password"), `${Handler.handlerName} must require password`);
    assert.equal(body.properties.password.type, "string", Handler.handlerName);
    assert.equal(body.properties.password.maxLength, 1024, Handler.handlerName);
  }
  // 而遮罩清單唔係 step-up route，佢唔應該收密碼。
  assert.deepEqual(ListSupplierBankAccountsHandler.api.requestSchema.body.properties, {});
});

test("every write body demands a reason, because the audit is useless without one", () => {
  for (const schema of [BANK_CREATE_SCHEMA, BANK_UPDATE_SCHEMA, BANK_VERSIONED_SCHEMA, BANK_REVEAL_SCHEMA]) {
    assert.ok(schema.required.includes("reason"), JSON.stringify(schema.required));
    assert.equal(schema.properties.reason.minLength, 5);
    assert.equal(schema.properties.reason.maxLength, 500);
  }
});

test("update and the versioned commands demand a version; create must not accept one", () => {
  for (const schema of [BANK_UPDATE_SCHEMA, BANK_VERSIONED_SCHEMA]) {
    assert.ok(schema.required.includes("version"));
  }
  // 一個 create 帶 version 係一個講唔通嘅請求 —— 行未存在，冇嘢可以比。收咗佢就係
  // 收一個會被靜靜哋忽略嘅欄位。
  assert.equal(BANK_CREATE_SCHEMA.properties.version, undefined);
  // 而 create 一定要有帳號，update 唔帶就係「唔改帳號」。
  assert.ok(BANK_CREATE_SCHEMA.required.includes("accountNumber"));
  assert.ok(!BANK_UPDATE_SCHEMA.required.includes("accountNumber"));
  assert.ok(BANK_UPDATE_SCHEMA.properties.accountNumber, "but update may still carry one");
});

test("the child routes name the account in the path, so ownership is a route parameter", () => {
  // 設計 §6.3：child route 一定要同時帶 Supplier 同 child 嘅 id，咁 service 先分得出
  // 「借另一個 Supplier 嘅 route」呢種請求。一條淨係帶 bankAccountId 嘅路根本無從判斷。
  for (const Handler of [UpdateSupplierBankAccountHandler, SetDefaultSupplierBankAccountHandler,
    DeactivateSupplierBankAccountHandler, RevealSupplierBankAccountHandler]) {
    const params = Handler.api.requestSchema.params;
    // `.sort()` 就地改陣列 —— 而個陣列依家係凍嘅（見最尾嗰條測試）。排個副本。
    assert.deepEqual([...params.required].sort(), ["bankAccountId", "id"], Handler.handlerName);
    for (const name of ["id", "bankAccountId"]) {
      assert.equal(params.properties[name].pattern, "^[1-9][0-9]{0,18}$",
        `${Handler.handlerName}.${name} must reject 0, negatives and anything non-numeric at the edge`);
    }
  }
});

/**
 * 呢度**只**斷言 `Pragma` —— 即係 handler 真正送得出嘅嗰個。
 *
 * 之前呢個測試仲斷言 handler 設咗 `Cache-Control: no-store, private`，而佢係綠嘅，
 * 但個 header 去唔到線上：`sendSuccess` 會喺 handler 之後覆寫成 `no-store`。一個直接
 * 行 `execute` 嘅測試**結構上**停喺覆寫之前一步，所以佢永遠捉唔到。REV-039 喺真
 * HTTP 上量到實際值，而依家真正嘅 cache header 斷言喺
 * `test/integration/supplierBank.integration.test.js` 嗰個成功 reveal 度 —— 讀
 * `response.headers`，唔係讀 handler 嘅意圖。
 *
 * 教訓比呢個 header 本身重要：一個斷言「我打算做乜」嘅測試，唔係一個斷言「發生咗乜」
 * 嘅測試。
 */
test("reveal sets the one cache header the framework does not overwrite", async () => {
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  const handler = Object.create(RevealSupplierBankAccountHandler.prototype);
  handler.banks = { async reveal() { return { id: 41, accountNumber: "123", revealedAt: 1 }; } };
  handler.response = (data) => data;

  const result = await handler.execute({
    auth: { claims: { sub: "1", roles: [], permissions: [] } },
    input: { params: { id: "7", bankAccountId: "41" }, body: { reason: "查看完整帳號" } },
    requestId: "req-1", ip: "127.0.0.1"
  }, res);

  assert.equal(result.accountNumber, "123");
  assert.equal(headers.Pragma, "no-cache", "for intermediaries that only speak HTTP/1.0 cache semantics");
  assert.equal(headers["Cache-Control"], undefined,
    "setting it here would be a no-op the framework discards; see the handler comment");
});

/**
 * 上面所有 response schema 嘅斷言，靠嘅係 response validation 真係行緊 —— 
 * `ResponseValidator.compile` 返回嘅 closure 第一句係 `if (!this.config.runtimeEnabled) return;`。
 * 熄咗個 flag，每個遮罩 Bank response 就會變成 service 回乜就出乜。所以喺呢度釘住
 * 出貨嘅設定值本身，唔淨係釘 normalizer 嘅行為。
 */
test("the shipped config leaves output validation on, including in production", async () => {
  const { default: requestConfig } = await import("../config/request.js");
  assert.equal(requestConfig.validation.output.enabled, true);
  assert.equal(requestConfig.validation.output.validateInProduction, true);
});

test("a route without a bankAccountId does not invent one", async () => {
  // `Number(undefined)` 係 NaN，而一個 NaN 落到 SQL 係一個查唔到嘢嘅查詢，唔係一個
  // 清楚嘅錯誤。所以 create／list 嘅 command 唔可以帶一個 bankAccountId 鍵。
  let seen = null;
  const handler = Object.create(CreateSupplierBankAccountHandler.prototype);
  handler.banks = { async create(input) { seen = input; return { id: 41 }; } };
  handler.response = (data) => data;
  await handler.execute({
    auth: { claims: { sub: "1", roles: [], permissions: [] } },
    input: { params: { id: "7" }, body: { reason: "新增帳戶" } },
    requestId: "req-1", ip: "127.0.0.1"
  });
  assert.equal(seen.supplierId, 7);
  assert.ok(!("bankAccountId" in seen), "a create must not carry a NaN bankAccountId");
});

/**
 * `Object.freeze` 係淺嘅，所以「response schema 講唔出帳號」呢個結構性主張，本身要靠
 * 個 schema 真係改唔到先成立。REV-041 指出 `MASKED_BANK_SCHEMA.properties` 當時仲係
 * 寫得到嘅。呢條測試釘住修正 —— 而且係試**加一個帳號欄位落遮罩 schema**，即係真正
 * 要擋嗰件事，唔係隨便試改一個屬性。
 */
test("the masked schema cannot have an account field added to it at runtime", () => {
  assert.throws(
    () => { "use strict"; MASKED_BANK_SCHEMA.properties.accountNumber = { type: "string" }; },
    TypeError
  );
  assert.equal(MASKED_BANK_SCHEMA.properties.accountNumber, undefined);

  // REV-042 L-3：上面兩句喺 `warnings` 個窿開住嘅時候一樣綠 —— 佢哋淨係掃到頂兩層。
  // 所以唔好逐個節點點名，行勻每一個 export 嘅每一層。呢個係唯一捉得到「守衛喺中間
  // 某層短路」嗰類錯嘅寫法。
  const unfrozen = [];
  const walk = (value, path) => {
    if (!value || typeof value !== "object") return;
    if (!Object.isFrozen(value)) unfrozen.push(path);
    for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
  };
  for (const [name, schema] of Object.entries(schemas)) {
    // supplierSchemas.js 嘅嘢，唔屬呢個檔案管。
    if (name === "SUPPLIER_ID_PARAMS_SCHEMA") continue;
    walk(schema, name);
  }
  assert.deepEqual(unfrozen, [], "every node of every Bank schema must be frozen at every depth");
});
