import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { normalizeItemConfig } from "../src/modules/item/normalizeItemConfig.js";

// 這裡釘的是「哪一種設定會被拒絕」，跟 configNormalizers.test.js 對其他
// normalizer 的態度一致：一個放行了無效值的 normalizer，會把設定錯誤從啟動
// 失敗降級成執行期的怪異行為（分類樹深到前端畫不動、匯入 batch 大到把交易
// 拖過 request timeout）。

const VALID = Object.freeze({
  categoryMaxDepth: 8,
  mediaDirectory: "storage/items",
  imageMaxBytes: 5_242_880,
  attachmentMaxBytes: 10_485_760,
  mediaOrphanGraceMs: 86_400_000,
  importDirectory: "storage/imports",
  importMaxRows: 10_000,
  importBatchSize: 200,
  importTransactionTimeoutMs: 120_000
});

test("accepts the documented default shape and freezes the result", () => {
  const config = normalizeItemConfig(VALID);

  assert.equal(config.categoryMaxDepth, 8);
  assert.equal(config.imageMaxBytes, 5_242_880);
  assert.equal(config.attachmentMaxBytes, 10_485_760);
  assert.equal(config.mediaOrphanGraceMs, 86_400_000);
  assert.equal(config.importMaxRows, 10_000);
  assert.equal(config.importBatchSize, 200);
  assert.equal(config.importTransactionTimeoutMs, 120_000);
  assert.equal(Object.isFrozen(config), true);
});

test("rejects a non-object source", () => {
  assert.throws(() => normalizeItemConfig(null), TypeError);
  assert.throws(() => normalizeItemConfig("nope"), TypeError);
  assert.throws(() => normalizeItemConfig([]), TypeError);
});

test("resolves a relative mediaDirectory to a controlled absolute path under the server root", () => {
  const config = normalizeItemConfig(VALID);

  assert.ok(path.isAbsolute(config.mediaDirectory));
  assert.match(config.mediaDirectory, /[/\\]storage[/\\]items$/);
});

test("keeps an already-absolute mediaDirectory as-is", () => {
  const absolute = path.resolve("/var/lib/erp-item-media");
  const config = normalizeItemConfig({ ...VALID, mediaDirectory: absolute });

  assert.equal(config.mediaDirectory, absolute);
});

test("rejects an empty or blank mediaDirectory", () => {
  assert.throws(
    () => normalizeItemConfig({ ...VALID, mediaDirectory: "" }),
    /mediaDirectory/
  );
  assert.throws(
    () => normalizeItemConfig({ ...VALID, mediaDirectory: "   " }),
    /mediaDirectory/
  );
});

test("resolves a relative importDirectory to a controlled absolute path under the server root", () => {
  const config = normalizeItemConfig(VALID);

  assert.ok(path.isAbsolute(config.importDirectory));
  assert.match(config.importDirectory, /[/\\]storage[/\\]imports$/);
});

test("keeps an already-absolute importDirectory as-is", () => {
  const absolute = path.resolve("/var/lib/erp-item-imports");
  const config = normalizeItemConfig({ ...VALID, importDirectory: absolute });

  assert.equal(config.importDirectory, absolute);
});

test("rejects an empty or blank importDirectory", () => {
  assert.throws(
    () => normalizeItemConfig({ ...VALID, importDirectory: "" }),
    /importDirectory/
  );
  assert.throws(
    () => normalizeItemConfig({ ...VALID, importDirectory: "   " }),
    /importDirectory/
  );
});

test("importDirectory and mediaDirectory stay independent even when one is overridden", () => {
  const config = normalizeItemConfig({ ...VALID, importDirectory: "custom/imports" });

  assert.match(config.mediaDirectory, /[/\\]storage[/\\]items$/);
  assert.match(config.importDirectory, /[/\\]custom[/\\]imports$/);
});

const POSITIVE_INTEGER_FIELDS = [
  "categoryMaxDepth",
  "imageMaxBytes",
  "attachmentMaxBytes",
  "mediaOrphanGraceMs",
  "importMaxRows",
  "importBatchSize",
  "importTransactionTimeoutMs"
];

for (const field of POSITIVE_INTEGER_FIELDS) {
  test(`rejects zero, negative and non-integer values for "${field}"`, () => {
    // null／undefined 刻意不在這裡：跟 normalizeDeviceBindingConfig 同一慣例，
    // `source.x ?? default` 把「沒有設定這個欄位」與「明確設成 null」視為同一
    // 件事，交給預設值；不是這個 normalizer 要單獨拒絕的錯誤。
    for (const bad of [0, -1, 1.5, "not-a-number"]) {
      assert.throws(
        () => normalizeItemConfig({ ...VALID, [field]: bad }),
        new RegExp(field),
        `expected "${field}" = ${JSON.stringify(bad)} to be rejected`
      );
    }
  });
}

test("rejects categoryMaxDepth above the safety ceiling", () => {
  assert.throws(
    () => normalizeItemConfig({ ...VALID, categoryMaxDepth: 21 }),
    /categoryMaxDepth/
  );
});

test("rejects imageMaxBytes/attachmentMaxBytes above the 100MB safety ceiling", () => {
  const overCeiling = 104_857_601;

  assert.throws(
    () => normalizeItemConfig({ ...VALID, imageMaxBytes: overCeiling }),
    /imageMaxBytes/
  );
  assert.throws(
    () => normalizeItemConfig({ ...VALID, attachmentMaxBytes: overCeiling }),
    /attachmentMaxBytes/
  );
});

test("rejects mediaOrphanGraceMs above the 30-day safety ceiling", () => {
  assert.throws(
    () => normalizeItemConfig({ ...VALID, mediaOrphanGraceMs: 31 * 24 * 60 * 60 * 1000 }),
    /mediaOrphanGraceMs/
  );
});

test("rejects importMaxRows above the safety ceiling", () => {
  assert.throws(
    () => normalizeItemConfig({ ...VALID, importMaxRows: 50_001 }),
    /importMaxRows/
  );
});

test("rejects importTransactionTimeoutMs above the 10-minute NFR-004 ceiling", () => {
  assert.throws(
    () => normalizeItemConfig({ ...VALID, importTransactionTimeoutMs: 10 * 60 * 1000 + 1 }),
    /importTransactionTimeoutMs/
  );
});

test("rejects an importBatchSize larger than importMaxRows", () => {
  assert.throws(
    () =>
      normalizeItemConfig({ ...VALID, importMaxRows: 100, importBatchSize: 200 }),
    /importBatchSize.*importMaxRows/
  );
});

test("an importBatchSize equal to importMaxRows is allowed", () => {
  const config = normalizeItemConfig({ ...VALID, importMaxRows: 200, importBatchSize: 200 });

  assert.equal(config.importBatchSize, 200);
  assert.equal(config.importMaxRows, 200);
});
