import assert from "node:assert/strict";
import test from "node:test";

import { BusinessMasterAdminService } from "../../src/modules/businessMaster/BusinessMasterAdminService.js";
import { BusinessMasterImpactRegistry } from "../../src/modules/businessMaster/BusinessMasterImpactRegistry.js";
import { BusinessMasterProvider } from "../../src/modules/businessMaster/BusinessMasterProvider.js";

function harness(overrides = {}) {
  const auditEntries = [];
  const database = {
    async withTransaction(work) { return work({ marker: "transaction" }); }
  };
  const repository = {
    async createCurrency(_connection, input) { return { ...input, status: "ACTIVE", version: 1, createdAt: 1, updatedAt: 1 }; },
    async updateCurrency() { return null; },
    async getCurrency(_connection, code) {
      return { code, name: "US Dollar", decimalPlaces: 2, status: "ACTIVE", version: 2, createdAt: 1, updatedAt: 1 };
    },
    async listCurrencies() { return { items: [], total: 0, page: 1, pageSize: 20 }; },
    async createPaymentTerm(_connection, input) { return { id: 7, ...input, status: "ACTIVE", version: 1, createdAt: 1, updatedAt: 1 }; },
    async getPaymentTerm(_connection, id) {
      return { id, code: "NET30", name: "Net 30", description: "", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 3, createdAt: 1, updatedAt: 1 };
    },
    async listPaymentTerms() { return { items: [], total: 0, page: 1, pageSize: 20 }; },
    ...overrides.repository
  };
  const service = new BusinessMasterAdminService({
    database,
    repository,
    audit: { async record(_connection, entry) { auditEntries.push(entry); } },
    impactRegistry: overrides.impactRegistry,
    authorize: overrides.authorize ?? (async () => ({ id: 9, username: "admin" })),
    time: { nowMs: () => 1_000 },
    logger: { info() {}, warn() {}, error() {} }
  });
  return { service, repository, auditEntries };
}

const actor = { actorId: 9, claimedRoles: ["system-admin"], claimedPermissions: ["business_master.mgmt"] };

test("TC-003 currency create validates, writes through a transaction, and records allowlisted audit", async () => {
  const { service, auditEntries } = harness();
  const created = await service.createCurrency({
    ...actor,
    code: "USD",
    name: "US Dollar",
    decimalPlaces: 2,
    correlationId: "req-1"
  });
  assert.equal(created.code, "USD");
  assert.equal(created.status, "ACTIVE");
  assert.equal(auditEntries.length, 1);
  assert.deepEqual(auditEntries[0].after, created);
  assert.equal("claimedPermissions" in auditEntries[0], false);
});

test("TC-004 a failed currency compare-and-swap surfaces VERSION_CONFLICT without success audit", async () => {
  const { service, auditEntries } = harness({ repository: { async updateCurrency() { return null; } } });
  await assert.rejects(
    () => service.updateCurrency({ ...actor, code: "USD", name: "Dollar", version: 1 }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
  assert.equal(auditEntries.length, 0);
});

test("TC-004 mutation revalidates the actor at commit point and rejects lifecycle no-op", async () => {
  let authorizationChecks = 0;
  const { service, auditEntries } = harness({
    authorize: async () => { authorizationChecks += 1; return { id: 9, username: "admin" }; }
  });
  await service.createCurrency({ ...actor, code: "USD", name: "US Dollar", decimalPlaces: 2 });
  assert.equal(authorizationChecks, 2);
  await assert.rejects(
    () => service.activateCurrency({ ...actor, code: "USD", version: 2, reason: "already active" }),
    (error) => error.publicCode === "STATUS_TRANSITION_INVALID"
  );
  assert.equal(auditEntries.length, 1);
});

test("TC-014 rejected high-risk deactivation records a separate rejected audit without a mutation", async () => {
  const rejection = Object.assign(new Error("stale impact"), { statusCode: 409, publicCode: "IMPACT_CHANGED" });
  const { service, auditEntries } = harness({
    impactRegistry: { async confirm() { throw rejection; } }
  });

  await assert.rejects(
    () => service.deactivateCurrency({ ...actor, code: "USD", version: 2, reason: "references changed", impactToken: "stale-token", correlationId: "req-rejected" }),
    (error) => error === rejection
  );
  assert.deepEqual(auditEntries, [{
    entityType: "CURRENCY",
    entityKey: "USD",
    action: "DEACTIVATE",
    result: "REJECTED",
    before: null,
    after: null,
    impact: null,
    reason: "references changed",
    actorUserId: 9,
    correlationId: "req-rejected",
    idempotencyKeyHash: null,
    createdAt: 1_000
  }]);
});

test("TC-005 payment term create normalizes identity and persists a valid conditional rule", async () => {
  const { service, auditEntries } = harness();
  const created = await service.createPaymentTerm({
    ...actor,
    code: "  ｎｅｔ３０ ",
    name: "Net 30",
    description: "Thirty days",
    calculationType: "NET_DAYS",
    dueDays: 30
  });
  assert.equal(created.code, "NET30");
  assert.equal(created.codeKey, undefined);
  assert.equal(created.dueDays, 30);
  assert.equal(auditEntries[0].entityType, "PAYMENT_TERM");
});

test("TC-008 calculates against the requested current payment term version", async () => {
  const { service } = harness();
  assert.deepEqual(await service.calculatePaymentTerm({ ...actor, id: 7, expectedVersion: 3, baseDate: "2024-01-31" }), {
    term: { id: 7, code: "NET30", name: "Net 30", version: 3, calculationType: "NET_DAYS", dueDays: 30 },
    baseDate: "2024-01-31",
    dueDate: "2024-03-01",
    requiresManualDueDate: false
  });
  await assert.rejects(
    () => service.calculatePaymentTerm({ ...actor, id: 7, expectedVersion: 2, baseDate: "2024-01-31" }),
    (error) => error.publicCode === "VERSION_CONFLICT"
  );
});

test("TC-009 impact confirmation is actor-bound, expiring, drift-sensitive, and fail closed", async () => {
  let now = 1_000;
  let watermark = "a";
  const registry = new BusinessMasterImpactRegistry({
    time: { nowMs: () => now },
    checkers: [
      { id: "customer", async check() { return { status: "READY", activeDefaultCount: 1, openUseCount: 0, historicalCount: 4, watermark }; } },
      { id: "supplier", async check() { return { status: "NOT_INSTALLED", activeDefaultCount: 0, openUseCount: 0, historicalCount: 0, watermark: "not-installed" }; } }
    ],
    requiredCheckerIds: ["customer", "supplier"]
  });
  const subject = { entityType: "CURRENCY", entityKey: "USD", version: 2, operation: "DEACTIVATE", proposedChange: { status: "INACTIVE" } };
  const preview = await registry.preview({ ...subject, actorId: 9 });
  assert.equal(preview.results[0].activeDefaultCount, 1);
  assert.equal(await registry.confirm({ ...subject, actorId: 9, impactToken: preview.impactToken }).then(() => true), true);
  await assert.rejects(() => registry.confirm({ ...subject, actorId: 8, impactToken: preview.impactToken }), (error) => error.publicCode === "IMPACT_TOKEN_INVALID");
  watermark = "b";
  await assert.rejects(() => registry.confirm({ ...subject, actorId: 9, impactToken: preview.impactToken }), (error) => error.publicCode === "IMPACT_CHANGED");
  watermark = "a";
  now += 300_001;
  await assert.rejects(() => registry.confirm({ ...subject, actorId: 9, impactToken: preview.impactToken }), (error) => error.publicCode === "IMPACT_TOKEN_EXPIRED");

  const unavailable = new BusinessMasterImpactRegistry({
    time: { nowMs: () => 1_000 },
    checkers: [{ id: "customer", async check() { throw new Error("down"); } }],
    requiredCheckerIds: ["customer"]
  });
  await assert.rejects(() => unavailable.preview({ ...subject, actorId: 9 }), (error) => error.publicCode === "IMPACT_CHECK_UNAVAILABLE");
});

test("TC-009 impact preview rejects operation and proposed-change mismatches before running checkers", async () => {
  let checks = 0;
  const impactRegistry = {
    async preview(input) { checks += 1; return input; }
  };
  const { service } = harness({ impactRegistry });
  await assert.rejects(
    () => service.previewImpact({ ...actor, entityType: "UNKNOWN", entityKey: "7", version: 3, operation: "DEACTIVATE", proposedChange: {} }),
    (error) => error.publicCode === "ENTITY_TYPE_INVALID"
  );
  await assert.rejects(
    () => service.previewImpact({ ...actor, entityType: "CURRENCY", entityKey: "USD", version: 2, operation: "CHANGE_RULE", proposedChange: { calculationType: "IMMEDIATE", dueDays: null } }),
    (error) => error.publicCode === "IMPACT_OPERATION_INVALID"
  );
  await assert.rejects(
    () => service.previewImpact({ ...actor, entityType: "PAYMENT_TERM", entityKey: "7", version: 3, operation: "CHANGE_RULE", proposedChange: { calculationType: "NET_DAYS" } }),
    (error) => error.publicCode === "PAYMENT_TERM_RULE_INVALID"
  );
  assert.equal(checks, 0);
});

test("TC-010 provider separates active selection, history, and transaction-aware revalidation", async () => {
  const repository = {
    async listCurrencies(_connection, { status }) { return { items: status === "ACTIVE" ? [{ code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 1 }] : [], total: 1, page: 1, pageSize: 100 }; },
    async getCurrency(_connection, code) { return { code, name: "Hong Kong Dollar", decimalPlaces: 2, status: "INACTIVE", version: 2 }; },
    async getPaymentTerm(_connection, id) { return { id, code: "NET30", name: "Net 30", description: "", calculationType: "NET_DAYS", dueDays: 30, status: "ACTIVE", version: 3 }; },
    async listPaymentTerms() { return { items: [], total: 0, page: 1, pageSize: 100 }; }
  };
  const provider = new BusinessMasterProvider({ database: {}, repository });
  assert.deepEqual(await provider.listActiveCurrencies(), [{ code: "HKD", name: "Hong Kong Dollar", decimalPlaces: 2, status: "ACTIVE", version: 1 }]);
  assert.equal((await provider.getCurrencyHistory("USD")).status, "INACTIVE");
  await assert.rejects(() => provider.assertCurrencyUsableInTransaction(null, { code: "HKD" }), TypeError);
  await assert.rejects(
    () => provider.assertCurrencyUsableInTransaction({ query() {} }, { code: "USD", expectedVersion: 2 }),
    (error) => error.publicCode === "CURRENCY_NOT_ACTIVE"
  );
  assert.equal((await provider.assertPaymentTermUsableInTransaction({ query() {} }, { id: 7, expectedVersion: 3 })).code, "NET30");
  assert.equal((await provider.assertCurrencyUsableInTransaction({ query() {} }, { code: "USD", expectedVersion: 2, purpose: "history" })).status, "INACTIVE");
  await assert.rejects(
    () => provider.assertPaymentTermUsableInTransaction({ query() {} }, { id: 7, purpose: "unknown" }),
    (error) => error.publicCode === "PROVIDER_PURPOSE_INVALID"
  );
  assert.deepEqual(await provider.calculateDueDateInTransaction({ query() {} }, { id: 7, expectedVersion: 3, baseDate: "2026-01-31" }), {
    term: { id: 7, code: "NET30", name: "Net 30", version: 3, calculationType: "NET_DAYS", dueDays: 30 },
    baseDate: "2026-01-31",
    dueDate: "2026-03-02",
    requiresManualDueDate: false
  });
});
