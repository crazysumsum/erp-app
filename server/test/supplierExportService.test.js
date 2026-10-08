import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "csv-parse/sync";

import { SUPPLIER_IMPORT_COLUMN_NAMES } from "../src/modules/supplier/import/supplierCsvSchema.js";
import { SupplierExportService } from "../src/modules/supplier/SupplierExportService.js";

/** TASK-047：匯出 service 嘅邏輯（上限、付款條款、稽核、檔名）。真 SQL、篩選同 Bank 檢查喺整合測試。 */
const supplier = (id, fields = {}) => ({
  id, supplier_code: `S-${id}`, supplier_name: `Supplier ${id}`, display_name: "", default_currency_code: "HKD",
  default_payment_term_id: null, website: "", general_phone: "", general_email: "", notes: "", ...fields
});

function fakes({ rows = [], auditFails = false } = {}) {
  const calls = { queries: [], audits: [], terms: [] };
  const database = {
    async query(sql, params) { calls.queries.push({ sql, params }); return [rows.slice(0, params.at(-1))]; },
    async withTransaction(work) { return work({ execute() {} }); }
  };
  const service = new SupplierExportService({
    database, time: { nowMs: () => Date.UTC(2026, 9, 6, 7, 8, 9, 123) }, maxRows: 2,
    authorize: async () => ({ username: "exporter" }),
    businessMaster: { async getPaymentTermHistory(id) { calls.terms.push(id); return { code: `TERM-${id}` }; } },
    audit: { async record(connection, input) { if (auditFails) throw new Error("audit down"); calls.audits.push(input); } }
  });
  return { service, calls };
}

const actor = { actorId: 7, claimedRoles: ["r"], claimedPermissions: ["supplier.mgmt"], requestId: "req-1", ip: "127.0.0.1" };

test("one query, limited to the cap plus one, reads suppliers only", async () => {
  const { service, calls } = fakes({ rows: [supplier(1)] });
  await service.exportCsv({ ...actor, filters: { q: "abc" } });
  assert.equal(calls.queries.length, 1);
  assert.equal(calls.queries[0].params.at(-1), 3);
  assert.match(calls.queries[0].sql, /FROM suppliers s WHERE/u);
  assert.doesNotMatch(calls.queries[0].sql, /bank|JOIN/iu);
});

test("more rows than the cap is a 422 with no audit and no file", async () => {
  const { service, calls } = fakes({ rows: [supplier(1), supplier(2), supplier(3)] });
  await assert.rejects(service.exportCsv({ ...actor }), (error) => error.code === "SUPPLIER_EXPORT_TOO_LARGE" && error.statusCode === 422);
  assert.equal(calls.audits.length, 0);
  assert.equal((await fakes({ rows: [supplier(1), supplier(2)] }).service.exportCsv({ ...actor })).rowCount, 2, "exactly the cap is fine");
});

test("each payment term is looked up once and written as its code", async () => {
  const { service, calls } = fakes({ rows: [supplier(1, { default_payment_term_id: 5 }), supplier(2, { default_payment_term_id: 5 })] });
  const { content } = await service.exportCsv({ ...actor });
  assert.deepEqual(calls.terms, [5]);
  const column = SUPPLIER_IMPORT_COLUMN_NAMES.indexOf("paymentTermCode");
  assert.deepEqual(parse(content, { bom: true }).slice(1).map((record) => record[column]), ["TERM-5", "TERM-5"]);
});

test("the audit names the actor, the filters and the count, and a failed audit means no file", async () => {
  const { service, calls } = fakes({ rows: [supplier(1, { notes: "secret-ish note" })] });
  const result = await service.exportCsv({ ...actor, filters: { status: "active" } });
  assert.deepEqual(calls.audits, [{
    actorUserId: 7, actorUsername: "exporter", action: "supplier.export", targetType: "export", targetLabel: "suppliers",
    detail: { metadata: { filters: { status: "active" } }, count: 1 }, requestId: "req-1", ip: "127.0.0.1"
  }]);
  assert.equal(result.fileName, "suppliers-20261006T070809Z.csv");
  await assert.rejects(fakes({ rows: [supplier(1)], auditFails: true }).service.exportCsv({ ...actor }), /audit down/u);
});

test("at most two exports run at once per process; a third is a 429, and a slot frees even after a failure (HD-074 2B)", async () => {
  const gate = { active: 0 };
  const releases = [];
  const database = {
    query: () => new Promise((resolve) => { releases.push(() => resolve([[supplier(1)]])); }),
    async withTransaction(work) { return work({ execute() {} }); }
  };
  const service = new SupplierExportService({
    database, time: { nowMs: () => 0 }, gate, authorize: async () => ({ username: "exporter" }),
    businessMaster: { async getPaymentTermHistory() { return null; } }, audit: { async record() {} }
  });
  const first = service.exportCsv({ ...actor });
  const second = service.exportCsv({ ...actor });
  await new Promise(setImmediate);
  await assert.rejects(service.exportCsv({ ...actor }), (error) => error.code === "SUPPLIER_EXPORT_BUSY" && error.statusCode === 429);
  assert.equal(gate.active, 2);
  releases.splice(0).forEach((release) => release());
  await Promise.all([first, second]);
  assert.equal(gate.active, 0);

  const failing = new SupplierExportService({
    database: { async query() { throw new Error("db down"); } }, time: { nowMs: () => 0 }, gate,
    authorize: async () => ({ username: "exporter" }), businessMaster: {}, audit: { async record() {} }
  });
  await assert.rejects(failing.exportCsv({ ...actor }), /db down/u);
  assert.equal(gate.active, 0, "a failed export frees its slot");
  await assert.rejects(new SupplierExportService({ database, time: { nowMs: () => 0 }, gate,
    authorize: async () => { throw new Error("stale"); }, businessMaster: {} }).exportCsv({ ...actor }), /stale/u);
  assert.equal(gate.active, 0, "a refused caller never takes a slot");
});
