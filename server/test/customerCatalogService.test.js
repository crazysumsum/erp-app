import assert from "node:assert/strict";
import test from "node:test";

import { CustomerCatalogService } from "../src/modules/customer/CustomerCatalogService.js";

function harness({ row = null, rows = [], updateAffectedRows = 1 } = {}) {
  const events = [];
  const catalogRow = row ?? {
    id: 4, code: "RETAIL", code_key: "retail", name: "Retail", description: "", status: "active",
    sort_order: 3, version: 2, created_at: 10, created_by: 1, updated_at: 20, updated_by: 1
  };
  const connection = {
    async query(sql, params) {
      events.push(["query", String(sql), params]);
      if (String(sql).includes("WHERE id = ?")) return [[catalogRow]];
      if (String(sql).includes("customer_categories")) return [rows.length ? rows : [catalogRow]];
      return [[]];
    },
    async execute(sql, params) {
      events.push(["execute", String(sql), params]);
      if (String(sql).includes("INSERT INTO customer_categories")) return [{ insertId: 9 }];
      return [{ affectedRows: updateAffectedRows }];
    }
  };
  const database = {
    query: connection.query.bind(connection),
    async withTransaction(work) { return work(connection); }
  };
  const service = new CustomerCatalogService({
    database,
    time: { nowMs: () => 100 },
    authorize: async () => ({ username: "sam", permissions: ["customer.view", "customer.settings"] }),
    audit: { async record(_connection, input) { events.push(["audit", input]); } }
  });
  return { service, events };
}

const actor = {
  actorId: 1,
  claimedRoles: [],
  claimedPermissions: ["customer.view", "customer.settings"],
  requestId: "req-1",
  ip: "127.0.0.1"
};

test("Customer catalog lists active values by default and permits includeInactive only to settings holders", async () => {
  const { service, events } = harness();
  const listed = await service.list("categories", actor);
  assert.equal(listed.items[0].code, "RETAIL");
  assert.match(events.find(([kind]) => kind === "query")[1], /status = 'active'/u);

  const denied = new CustomerCatalogService({
    database: harness().service.database,
    time: { nowMs: () => 1 },
    authorize: async () => ({ username: "viewer", permissions: ["customer.view"] })
  });
  await assert.rejects(() => denied.list("categories", { ...actor, includeInactive: true }), (error) => error.publicCode === "CUSTOMER_CATALOG_FORBIDDEN");
});

test("Customer catalog creates, updates and deactivates only fixed catalog tables with CAS audit", async () => {
  const { service, events } = harness();
  const created = await service.create("categories", {
    ...actor, code: "RETAIL", name: "Retail", description: "", sortOrder: 3, reason: "新增零售客戶分類"
  });
  assert.equal(created.id, 9);
  assert.equal(created.status, "active");
  assert.equal(events.find(([kind]) => kind === "audit")[1].action, "catalog.create");

  await service.update("categories", {
    ...actor, id: 4, code: "RETAIL", name: "Retail", description: "更新", sortOrder: 4, version: 2, reason: "更新零售分類說明"
  });
  await service.deactivate("categories", { ...actor, id: 4, version: 2, reason: "停止使用零售分類" });
  assert.equal(events.some(([, sql = ""]) => /customer_industries|customer_territories/u.test(sql)), false);
});

test("Customer catalog rejects unknown catalog values and stale writes without an audit", async () => {
  const { service } = harness({ updateAffectedRows: 0 });
  await assert.rejects(() => service.list("unknown", actor), (error) => error.publicCode === "CUSTOMER_CATALOG_INVALID");
  await assert.rejects(
    () => service.update("categories", { ...actor, id: 4, code: "RETAIL", name: "Retail", description: "", sortOrder: 3, version: 2, reason: "更新零售分類資料" }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
});
