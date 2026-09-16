import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BusinessMasterProvider } from "../../../src/modules/businessMaster/BusinessMasterProvider.js";
import { createBusinessMasterAdminService } from "../../../src/modules/businessMaster/businessMasterFactory.js";

const here = dirname(fileURLToPath(import.meta.url));

test("TC-020 v1 consumer provider returns minimal stable projections without admin permission input", async () => {
  const currency = { code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 4 };
  const term = { id: 8, code: "NET30", name: "Net 30", description: "Thirty days", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 2 };
  const listCalls = [];
  const repository = {
    async listCurrencies(_connection, input) { listCalls.push(["currency", input]); return { items: [currency], total: 1, page: 1, pageSize: 100 }; },
    async listPaymentTerms(_connection, input) { listCalls.push(["payment-term", input]); return { items: [term], total: 1, page: 1, pageSize: 100 }; },
    async getCurrency() { return currency; },
    async getPaymentTerm() { return term; }
  };
  const provider = new BusinessMasterProvider({ database: {}, repository });
  assert.equal(BusinessMasterProvider.contract, "business-master-currency-payment-term-provider/v1");
  assert.deepEqual(await provider.listActiveCurrencies({ page: 2, pageSize: 50 }), [{ code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 4 }]);
  assert.deepEqual(await provider.listActivePaymentTerms({ page: 3, pageSize: 20 }), [{ id: 8, code: "NET30", name: "Net 30", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 2 }]);
  assert.deepEqual(listCalls, [
    ["currency", { status: "ACTIVE", page: 2, pageSize: 50 }],
    ["payment-term", { status: "ACTIVE", page: 3, pageSize: 20 }]
  ]);
  assert.equal((await provider.getPaymentTermHistory(8)).description, undefined);
  assert.deepEqual(provider.calculatePaymentTermSnapshot(term, "2026-01-31"), {
    term: { id: 8, code: "NET30", name: "Net 30", version: 2, calculationType: "NET_DAYS", dueDays: 30 },
    baseDate: "2026-01-31",
    dueDate: "2026-03-02",
    requiresManualDueDate: false
  });
});

test("TC-020 active/new-assignment and inactive/history semantics are stable for every consumer", async () => {
  const activeCurrency = { code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 4 };
  const inactiveCurrency = { code: "USD", name: "US Dollar", decimalPlaces: 2, status: "INACTIVE", version: 7 };
  const activeTerm = { id: 8, code: "NET30", name: "Net 30", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 2 };
  const inactiveTerm = { id: 9, code: "MANUAL", name: "Manual", calculationType: "MANUAL", dueDays: null, status: "INACTIVE", version: 3 };
  const repository = {
    async listCurrencies() { return { items: [activeCurrency], total: 1 }; },
    async listPaymentTerms() { return { items: [activeTerm], total: 1 }; },
    async getCurrency(_connection, code) { return code === "USD" ? inactiveCurrency : activeCurrency; },
    async getPaymentTerm(_connection, id) { return id === 9 ? inactiveTerm : activeTerm; }
  };
  const provider = new BusinessMasterProvider({ database: {}, repository });
  const connection = { query() {} };

  assert.deepEqual(await provider.getCurrencyHistory("USD"), inactiveCurrency);
  assert.deepEqual(await provider.getPaymentTermHistory(9), inactiveTerm);
  assert.deepEqual(
    await provider.assertCurrencyUsableInTransaction(connection, { code: "USD", expectedVersion: 7, purpose: "history" }),
    inactiveCurrency
  );
  assert.deepEqual(
    await provider.assertPaymentTermUsableInTransaction(connection, { id: 9, expectedVersion: 3, purpose: "history" }),
    inactiveTerm
  );
  await assert.rejects(
    provider.assertCurrencyUsableInTransaction(connection, { code: "USD", purpose: "new_assignment" }),
    (error) => error.code === "CURRENCY_NOT_ACTIVE"
  );
  await assert.rejects(
    provider.assertPaymentTermUsableInTransaction(connection, { id: 9, purpose: "new_assignment" }),
    (error) => error.code === "PAYMENT_TERM_NOT_ACTIVE"
  );
  await assert.rejects(
    provider.assertCurrencyUsableInTransaction(connection, { code: "HKD", expectedVersion: 3 }),
    (error) => error.code === "VERSION_CONFLICT"
  );
  await assert.rejects(
    provider.assertCurrencyUsableInTransaction(null, { code: "HKD" }),
    { name: "TypeError", message: "A caller-owned transaction connection is required" }
  );
});

test("TC-020 payment snapshots preserve rule/version and cover calendar/manual results", async () => {
  const provider = new BusinessMasterProvider({ database: {}, repository: {} });
  const endOfMonth = { id: 2, code: "EOM", name: "Month end", calculationType: "END_OF_MONTH", dueDays: null, version: 5 };
  const manual = { id: 3, code: "MAN", name: "Manual", calculationType: "MANUAL", dueDays: null, version: 6 };

  assert.deepEqual(provider.calculatePaymentTermSnapshot(endOfMonth, "2024-02-10"), {
    term: endOfMonth,
    baseDate: "2024-02-10",
    dueDate: "2024-02-29",
    requiresManualDueDate: false
  });
  assert.deepEqual(provider.calculatePaymentTermSnapshot(manual, "2026-09-14"), {
    term: manual,
    baseDate: "2026-09-14",
    dueDate: null,
    requiresManualDueDate: true
  });
});

function factoryServices(database) {
  return {
    require(name) {
      if (name === "mysqldatabase") return database;
      if (name === "time") return { nowMs: () => 1_757_808_000_000 };
      if (name === "logging") return { logger: { info() {}, error() {} } };
      throw new Error(`unexpected service ${name}`);
    }
  };
}

test("TC-020 all six absent consumer modules report explicit NOT_INSTALLED, never an unknown success", async () => {
  const database = { async query() { return [[{ present: 0 }]]; } };
  const admin = createBusinessMasterAdminService(factoryServices(database));
  const preview = await admin.impactRegistry.preview({
    actorId: 1,
    entityType: "CURRENCY",
    entityKey: "HKD",
    version: 1,
    operation: "DEACTIVATE",
    proposedChange: { status: "INACTIVE" }
  });

  assert.deepEqual(preview.results.map(({ checkerId, status }) => ({ checkerId, status })), [
    { checkerId: "ap", status: "NOT_INSTALLED" },
    { checkerId: "ar", status: "NOT_INSTALLED" },
    { checkerId: "customer", status: "NOT_INSTALLED" },
    { checkerId: "purchasing", status: "NOT_INSTALLED" },
    { checkerId: "sales", status: "NOT_INSTALLED" },
    { checkerId: "supplier", status: "NOT_INSTALLED" }
  ]);
  assert.ok(preview.results.every((result) =>
    result.activeDefaultCount === 0 && result.openUseCount === 0 && result.historicalCount === 0
  ));
});

test("TC-020 the registered Customer checker reports Currency defaults without exposing Customer records", async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes("information_schema.tables")) {
        return [[{ present: sql.includes("table_name = 'customers'") ? 1 : 0 }]];
      }
      assert.match(sql, /FROM customers/);
      assert.deepEqual(params, ["HKD"]);
      return [[{ status: "active", reference_count: 2, version_sum: 5, latest_updated_at: 11, max_id: 4 }]];
    }
  };
  const admin = createBusinessMasterAdminService(factoryServices(database));
  const preview = await admin.impactRegistry.preview({
    actorId: 1,
    entityType: "CURRENCY",
    entityKey: "HKD",
    version: 1,
    operation: "DEACTIVATE",
    proposedChange: { status: "INACTIVE" }
  });

  assert.deepEqual(preview.results.map(({ watermark: _watermark, ...result }) => result), [
    { checkerId: "ap", status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0 },
    { checkerId: "ar", status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0 },
    { checkerId: "customer", status: "READY", activeDefaultCount: 2, openUseCount: 0, historicalCount: 0 },
    { checkerId: "purchasing", status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0 },
    { checkerId: "sales", status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0 },
    { checkerId: "supplier", status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0 }
  ]);
  assert.match(preview.results[2].watermark, /^customer:CURRENCY:HKD:/);
});

test("TC-020 an installed consumer without its real checker fails closed", async () => {
  const database = { async query() { return [[{ present: 1 }]]; } };
  const admin = createBusinessMasterAdminService(factoryServices(database));

  await assert.rejects(
    admin.impactRegistry.preview({
      actorId: 1,
      entityType: "CURRENCY",
      entityKey: "HKD",
      version: 1,
      operation: "DEACTIVATE",
      proposedChange: { status: "INACTIVE" }
    }),
    (error) => error.code === "IMPACT_CHECK_UNAVAILABLE" && error.statusCode === 503
  );
});

test("TC-020 no module outside Business Master writes a shadow Currency or Payment Term catalog", async () => {
  const migrationDir = join(here, "../../../database/migrations");
  const sourceDir = join(here, "../../../src");
  const migrationNames = Array.from({ length: 26 }, (_, index) => String(index + 1).padStart(4, "0"));
  const migrationFiles = await Promise.all(migrationNames.map(async (prefix) => {
    const { readdir } = await import("node:fs/promises");
    return (await readdir(migrationDir)).find((name) => name.startsWith(prefix));
  }));
  const migrationContents = await Promise.all(migrationFiles.filter(Boolean).map((name) => readFile(join(migrationDir, name), "utf8")));
  assert.ok(migrationContents.every((content) => !/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:currencies|payment_terms)\b/i.test(content)));

  const { readdir } = await import("node:fs/promises");
  async function sourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "businessMaster" ? [] : sourceFiles(path);
      return entry.isFile() && path.endsWith(".js") ? [path] : [];
    }));
    return nested.flat();
  }
  const contents = await Promise.all((await sourceFiles(sourceDir)).map((path) => readFile(path, "utf8")));
  assert.ok(contents.every((content) => !/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:currencies|payment_terms)\b/i.test(content)));
});
