import assert from "node:assert/strict";
import test from "node:test";
import { PERMISSION_CATALOGUE } from "../src/modules/authorization/permissionCatalogue.js";
import { PermissionCatalogueService } from "../src/services/authorization/PermissionCatalogueService.js";

/**
 * 啟動自檢守的是一種沒有症狀的壞法：migration 沒跑完，於是 handler 要求的權限
 * 沒有任何角色配得到——系統登得進去、每一頁都在、功能一個都用不了。這種狀態
 * 查起來最貴，所以寧可在啟動時大聲失敗一次。
 *
 * 用假的資料庫而不是真連線：這裡要測的是比對邏輯與三種處置的分岔，不是 SQL。
 * 真資料庫那一半由 integration 測試蓋（跑完 migration 之後三個權限都在）。
 */

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };

  return {
    entries,
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error")
  };
}

function createService(rows, { logger = collectingLogger() } = {}) {
  const database = {
    query: async () => [rows]
  };

  const service = new PermissionCatalogueService({
    config: {},
    services: {
      require: (name) => ({ mysqldatabase: database, logging: { logger } })[name]
    }
  });

  return { service, logger };
}

/** 資料庫剛好與目錄一致的那一份列。 */
const inSync = () =>
  PERMISSION_CATALOGUE.map((permission) => ({
    name: permission.name,
    description: permission.description
  }));

test("a database that matches the catalogue starts silently", async () => {
  const { service, logger } = createService(inSync());

  await service.initialize();

  // 沒有 warn 是這個測試的重點：一條每次啟動都會出現的 warn，會在第二個星期
  // 被所有人當成背景噪音，然後真正的漂移就再也沒有人看得見。
  assert.deepEqual(
    logger.entries.filter((entry) => entry.level === "warn"),
    []
  );
});

test("a missing permission refuses to start, and says which one", async () => {
  const rows = inSync().filter((row) => row.name !== "user.mgmt");
  const { service } = createService(rows);

  await assert.rejects(
    () => service.initialize(),
    (error) => {
      // 指名缺哪一個。「權限目錄不一致」那種訊息會讓看到的人再花十分鐘
      // 才走到這一步。
      assert.match(error.message, /user\.mgmt/);
      // 而且要說出下一步該做什麼。
      assert.match(error.message, /migrate/);
      return true;
    }
  );
});

test("every catalogue entry is checked, not just the first", async () => {
  // 只查第一項的實作會讓這個測試通過而上一個測試也通過——所以逐項都試一次。
  for (const missing of PERMISSION_CATALOGUE) {
    const rows = inSync().filter((row) => row.name !== missing.name);
    const { service } = createService(rows);

    await assert.rejects(
      () => service.initialize(),
      (error) => {
        assert.match(error.message, new RegExp(missing.name.replace(".", "\\.")));
        return true;
      },
      `missing ${missing.name} did not fail startup`
    );
  }
});

test("an extra permission only warns: removing one from the code is normal evolution", async () => {
  const rows = [...inSync(), { name: "invoice.approve", description: "手動加的" }];
  const { service, logger } = createService(rows);

  // 不 throw——拒絕啟動會讓「上一版還有、這一版移除了」變成一次停機。
  await service.initialize();

  const warning = logger.entries.find(
    (entry) => entry.event === "authorization.catalogue.extra_permissions"
  );

  assert.ok(warning, "an extra permission should leave a trace");
  assert.equal(warning.level, "warn");
  assert.deepEqual(warning.context.permissions, ["invoice.approve"]);
});

test("a drifting description only warns: it is display text, not a judgement", async () => {
  const rows = inSync().map((row) =>
    row.name === "role.mgmt" ? { ...row, description: "舊的說明" } : row
  );
  const { service, logger } = createService(rows);

  await service.initialize();

  const warning = logger.entries.find(
    (entry) => entry.event === "authorization.catalogue.description_drift"
  );

  assert.ok(warning, "a drifting description should leave a trace");
  assert.equal(warning.level, "warn");
  assert.equal(warning.context.permission, "role.mgmt");
  assert.equal(warning.context.database, "舊的說明");
});

test("the self-check never writes: the permissions table is read-only to the app", async () => {
  const calls = [];
  const database = {
    query: async (sql) => {
      calls.push(sql);
      return [[]];
    },
    execute: async (sql) => {
      calls.push(sql);
      return [{}];
    }
  };

  const service = new PermissionCatalogueService({
    config: {},
    services: {
      require: (name) =>
        ({ mysqldatabase: database, logging: { logger: collectingLogger() } })[name]
    }
  });

  // 資料庫是空的，所以這一定會失敗——重點是它失敗的方式。
  await assert.rejects(() => service.initialize());

  // 「缺了就自己補進去」會讓 permissions 變成一張程式碼寫得了的表，而
  // 「沒有人能改這張表」是這整套設計的第一條規則。這條斷言就是那條規則。
  for (const sql of calls) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i,
      `the catalogue self-check must not write: ${sql}`
    );
  }
});
