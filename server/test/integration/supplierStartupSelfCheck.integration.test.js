import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN, runRunner, scratchDatabase } from "./supplierScratchDatabase.js";
import { runStartupCases, tryStart } from "./supplierStartupCases.js";

/**
 * DEF-033（HD-121 A；設計 §14.1 第 4 步）：開機自我檢查。一個全新 migrate 嘅 scratch database 先開到機（對照組），
 * 之後逐樣拎走：非核心 table、column、0080 同 0087 嘅 index、settings singleton、permission。每次都要拒絕開機、講明缺咗乜、唔改 DB，
 * 還原之後又開到機。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("DEF-033 (HD-121 A): startup refuses a missing Supplier table, column, index, settings row or permission, changes nothing, and starts after repair", async (t) => {
  const { name, connection } = await scratchDatabase(t);
  await runRunner(name);
  const credentials = { database: name, user: ADMIN.user, password: ADMIN.password };
  assert.equal((await tryStart(credentials)).started, true, "a complete schema starts: the control for every refusal below");

  const results = await runStartupCases({ admin: connection, schema: name, user: ADMIN.user, password: ADMIN.password });
  assert.equal(results.length, 7);
  for (const result of results) {
    assert.deepEqual([result.name, result.error, result.refused, result.unchanged, result.startsAfterRestore],
      [result.name, undefined, true, true, true], `${result.name}: ${result.message}`);
  }
});
