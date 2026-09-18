import assert from "node:assert/strict";
import test from "node:test";

import {
  ApproveSupplierApprovalHandler,
  GetSupplierApprovalHandler,
  ListSupplierApprovalsHandler,
  ReassignSupplierApprovalHandler,
  RejectSupplierApprovalHandler
} from "../src/handlers/supplier-approvals/approvalHandlers.js";
import { ListSupplierApproversHandler } from "../src/handlers/supplier-approvers/listSupplierApproversHandler.js";
import { WithdrawSupplierApprovalHandler } from "../src/handlers/suppliers/supplierApprovalWithdrawHandler.js";
import { BlockSupplierHandler, UnblockSupplierHandler } from "../src/handlers/suppliers/supplierLifecycleHandlers.js";
import apiConfig from "../config/api.js";

/**
 * 呢個檔案守住 HTTP contract 本身：邊條路徑、要幾強嘅認證、要邊幾個 permission、
 * body 收唔收得多嘅欄位、response 可以講出乜。Domain 規則喺
 * supplierApprovalService.test.js，真 SQL 喺 integration/supplierApproval。
 */

const QUEUE_HANDLERS = [ListSupplierApprovalsHandler, GetSupplierApprovalHandler];
const DECISION_HANDLERS = [ApproveSupplierApprovalHandler, RejectSupplierApprovalHandler, ReassignSupplierApprovalHandler];

function permissionsOf(Handler) {
  const [policy] = Handler.api.authorizationPolicies;
  return policy.options.permissions;
}

test("the approval routes sit exactly where design 6.4 puts them", () => {
  assert.equal(ListSupplierApprovalsHandler.api.path, "/api/v1/supplier-approvals");
  assert.equal(GetSupplierApprovalHandler.api.path, "/api/v1/supplier-approvals/:id");
  assert.equal(ApproveSupplierApprovalHandler.api.path, "/api/v1/supplier-approvals/:id/approve");
  assert.equal(RejectSupplierApprovalHandler.api.path, "/api/v1/supplier-approvals/:id/reject");
  assert.equal(ReassignSupplierApprovalHandler.api.path, "/api/v1/supplier-approvals/:id/reassign");
  assert.equal(ListSupplierApproversHandler.api.path, "/api/v1/supplier-approvers");
  assert.equal(WithdrawSupplierApprovalHandler.api.path, "/api/v1/suppliers/:id/approval/withdraw");
});

test("every queue and decision route demands supplier.view AND supplier.approval, nothing weaker", () => {
  // 設計 6.4：呢個期冇 approval.admin，所以 queue 同決定都係同一對 permission。
  for (const Handler of [...QUEUE_HANDLERS, ...DECISION_HANDLERS]) {
    assert.deepEqual(permissionsOf(Handler), ["supplier.view", "supplier.approval"], Handler.handlerName);
    assert.notEqual(Handler.api.authorizationPolicies[0].options.match, "any",
      `${Handler.handlerName} must require both permissions, not either of them`);
  }
});

test("the approver lookup accepts mgmt or approval, and is not a User Admin API", () => {
  // 設計 6.4：建檔人（supplier.mgmt）要揀審批人，所以佢唔可以淨係要 approval。
  const policy = ListSupplierApproversHandler.api.authorizationPolicies[0];
  assert.deepEqual(policy.options.permissions, ["supplier.mgmt", "supplier.approval"]);
  assert.equal(policy.options.match, "any");
});

test("approve, reject and reassign re-confirm the password; reading the queue does not", () => {
  for (const Handler of DECISION_HANDLERS) {
    assert.equal(Handler.api.authType, "jwt-password", `${Handler.handlerName} must re-confirm the password`);
  }
  for (const Handler of [...QUEUE_HANDLERS, ListSupplierApproversHandler]) {
    assert.equal(Handler.api.authType, undefined, `${Handler.handlerName} must not demand a password to read`);
  }
  // REV-026 L-5：上面斷言嘅係「冇寫」，唔係「係 jwt」。冇寫解讀成乜，由 config 話事，
  // 所以喺度釘死個預設 —— 如果將來預設變咗 public，呢五條 route 會靜靜哋開晒。
  assert.equal(apiConfig.defaults.authType, "jwt",
    "the read routes rely on the framework default; if that default changes they silently change with it");
});

test("the block routes keep device-password: the approval work does not weaken them", () => {
  // T29 acceptance criterion 2：approval 用 jwt-password，block 相關 route 維持
  // device-password。呢個斷言喺同一個檔案入面，所以將來把 block 降級會即刻著紅燈。
  for (const Handler of [BlockSupplierHandler, UnblockSupplierHandler]) {
    assert.equal(Handler.api.authType, "jwt-device-password", Handler.handlerName);
    assert.deepEqual(permissionsOf(Handler), ["supplier.view", "supplier.approval"]);
  }
});

test("withdraw stays a requester action on the Supplier route", () => {
  // 設計 6.4：撤回係建檔人做嘅，唔係 queue 操作，所以 jwt + supplier.mgmt。
  assert.equal(WithdrawSupplierApprovalHandler.api.authType, undefined);
  assert.deepEqual(permissionsOf(WithdrawSupplierApprovalHandler), ["supplier.mgmt"]);
});

test("every request schema on every approval route is closed", () => {
  const handlers = [...QUEUE_HANDLERS, ...DECISION_HANDLERS, ListSupplierApproversHandler, WithdrawSupplierApprovalHandler];
  for (const Handler of handlers) {
    for (const [part, schema] of Object.entries(Handler.api.requestSchema)) {
      assert.equal(schema.additionalProperties, false, `${Handler.handlerName}.${part} is open`);
    }
  }
});

test("the queue defaults to mine and refuses a scope it does not know", () => {
  const query = ListSupplierApprovalsHandler.api.requestSchema.query;
  assert.equal(query.properties.scope.default, "mine");
  assert.deepEqual(query.properties.scope.enum, ["mine", "all", "unassigned"]);
});

test("the queue pages on the server: the client cannot ask for everything", () => {
  const query = ListSupplierApprovalsHandler.api.requestSchema.query;
  assert.equal(query.properties.pageSize.maximum, 100);
  assert.equal(query.properties.pageSize.minimum, 1);
  assert.equal(query.properties.page.minimum, 1);
});

test("reject and reassign demand a reason; approve does not invent one", () => {
  assert.ok(RejectSupplierApprovalHandler.api.requestSchema.body.required.includes("reason"));
  assert.ok(ReassignSupplierApprovalHandler.api.requestSchema.body.required.includes("reason"));
  assert.ok(!ApproveSupplierApprovalHandler.api.requestSchema.body.required.includes("reason"));
  for (const Handler of DECISION_HANDLERS) {
    for (const field of ["password", "version"]) {
      assert.ok(Handler.api.requestSchema.body.required.includes(field), `${Handler.handlerName} must require ${field}`);
    }
  }
  assert.ok(ReassignSupplierApprovalHandler.api.requestSchema.body.required.includes("approverUserId"));
});

test("the eligible approver projection is exactly id, username and displayName", () => {
  // 設計 6.4／SEC-009：唔回 roles、其他 permission、email 或帳號安全狀態。
  const item = ListSupplierApproversHandler.api.responseSchema[200].properties.items.items;
  assert.deepEqual(Object.keys(item.properties).sort(), ["displayName", "id", "username"]);
  assert.equal(item.additionalProperties, false);
});

test("the eligible approver lookup is capped and can exclude the requester", () => {
  const query = ListSupplierApproversHandler.api.requestSchema.query;
  assert.equal(ListSupplierApproversHandler.api.responseSchema[200].properties.items.maxItems, 100);
  assert.deepEqual(Object.keys(query.properties).sort(), ["excludeUserId", "q"]);
});

test("no approval response can name a bank field, and none of them is open", () => {
  // 設計 6.4：approval detail 唔自動 reveal 銀行資料。一個開放嘅 response schema
  // 會令服務層將來加一個欄位就靜靜哋出到街，所以呢度行勻成棵樹。
  const handlers = [...QUEUE_HANDLERS, ...DECISION_HANDLERS, ListSupplierApproversHandler, WithdrawSupplierApprovalHandler];
  const forbidden = /bank|iban|swift|accountNumber/iu;
  const walk = (schema, where) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.type === "object" || schema.properties) {
      assert.equal(schema.additionalProperties, false, `${where} is an open object`);
      for (const [name, child] of Object.entries(schema.properties ?? {})) {
        assert.ok(!forbidden.test(name), `${where}.${name} exposes bank data on an approval route`);
        walk(child, `${where}.${name}`);
      }
    }
    if (schema.items) walk(schema.items, `${where}[]`);
  };
  for (const Handler of handlers) {
    for (const [code, schema] of Object.entries(Handler.api.responseSchema)) {
      walk(schema, `${Handler.handlerName}.${code}`);
    }
  }
});

test("the withdraw handler passes the route Supplier id into the command", async () => {
  // REV-026 H-1：service 嗰邊嘅 scope 檢查係 `input.supplierId !== undefined`，所以
  // 呢行接線就係武裝佢嘅唯一嘢。冇呢個測試，刪咗佢 suite 一樣全綠，而任何人都可以
  // 借 Supplier B 嘅 route 撤 Supplier A 嘅申請。
  const handler = new WithdrawSupplierApprovalHandler({ require: () => ({ logger: { warn() {} }, nowMs: () => 1 }) });
  const passed = [];
  handler.approvals = { async withdrawRequest(input) { passed.push(input); return { id: input.id }; } };
  await handler.execute({
    auth: { claims: { sub: "5", roles: [], permissions: ["supplier.mgmt"] } },
    input: { params: { id: "7" }, query: {}, body: { requestId: 11, version: 2 } },
    requestId: "req-1",
    ip: "127.0.0.1"
  });
  assert.equal(passed.length, 1);
  assert.equal(passed[0].supplierId, 7, "the route Supplier id must reach the service, or its scope guard never arms");
  assert.equal(passed[0].id, 11, "the request id comes from the body, not from the route");
  assert.equal(passed[0].actorId, 5);
  // REV-027 L-8：呢度本來寫成 `!("requestId" in x) || x.requestId === "req-1"`，
  // 兩邊都真，永遠過。handler 由 body 抽走 requestId 再擺入 framework 嗰個，所以
  // 呢個斷言真正守住嘅係：body 嘅 requestId 唔會蓋過 correlation id。
  assert.equal(passed[0].requestId, "req-1");
  assert.equal(passed[0].ip, "127.0.0.1");
});

test("withdraw refuses to run unscoped, so a lost caller line is loud", async () => {
  // 同一個控制嘅另一半：就算接線斷咗，service 都唔會靜靜哋撤一個唔知邊個 Supplier
  // 嘅申請。
  const { SupplierApprovalService } = await import("../src/modules/supplier/SupplierApprovalService.js");
  const service = new SupplierApprovalService({
    database: { async withTransaction() { throw new Error("must not reach the transaction"); } },
    logger: { warn() {} },
    time: { nowMs: () => 1 }
  });
  assert.throws(() => service.withdrawRequest({ actorId: 1, id: 11, version: 1 }), TypeError);
});
