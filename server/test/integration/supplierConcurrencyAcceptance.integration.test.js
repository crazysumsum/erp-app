import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { stringify } from "csv-stringify/sync";

import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES } from "../../src/modules/supplier/import/supplierCsvSchema.js";
import { createSupplierHarness } from "./supplierHttpHarness.js";

/**
 * TASK-051 step 2b：IMP-008（匯入 upload／confirm 冪等），真 app、真 HTTP、真 MySQL，並發請求同時發出。
 * SKU-005 嘅 carrier 等 HD-113（supplier_sku_refs 嘅 SKU FK 冇強制執行）處理完先加。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = Object.assign(createSupplierHarness("con51"), { users: {} });

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  await h.start();
  h.users.mgmt = await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
});

after(() => h.stop());

const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function upload(content, key) {
  const form = new FormData();
  form.append("mode", "create_only");
  form.append("file", new Blob([content], { type: "text/csv" }), "suppliers.csv");
  const response = await fetch(`${h.url}/api/v1/supplier-imports/upload`, { method: "POST", body: form,
    headers: { authorization: `Bearer ${h.users.mgmt.token}`, "idempotency-key": key } });
  const json = await response.json();
  if (response.status === 201 && !h.jobIds.includes(json.data.id)) h.jobIds.push(json.data.id);
  return { status: response.status, code: json.error?.code ?? null, json };
}

async function precheck(jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await h.worker.runPrecheck(new AbortController().signal);
    if (!result.claimed || result.jobId === jobId) return;
  }
}

async function execute(jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [[job]] = await h.db.query("SELECT status FROM supplier_import_jobs WHERE id = ?", [jobId]);
    if (!["queued", "running"].includes(job.status)) return job.status;
    const result = await h.worker.runExecution(new AbortController().signal);
    if (!result.claimed) await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error(`job ${jobId} never finished`);
}

integrationTest("TC-093 (IMP-008): one key makes one job whether repeated or raced, a different file under it is refused, a double confirm queues once, and the same file under two keys never creates a Supplier twice", async () => {
  const t = tag();
  const csv = (codes) => stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...codes.map((code) =>
    SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => ({ supplierCode: code, supplierName: `Imported ${code}`, defaultCurrencyCode: "HKD" })[name] ?? ""))],
  SUPPLIER_CSV_STRINGIFY_OPTIONS);
  const codes = [`IMA-${t}`, `IMB-${t}`];
  const file = csv(codes);
  const jobsBefore = async () => {
    const [[{ n }]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_import_jobs WHERE created_by = ?", [h.users.mgmt.userId]);
    return Number(n);
  };
  const start = await jobsBefore();

  // 同 key：連續重送回同一個 job；同時送都只得一個 job。
  const key = randomUUID();
  const first = await upload(file, key);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const repeat = await upload(file, key);
  assert.deepEqual([repeat.status, repeat.json.data?.id], [201, first.json.data.id], "the repeat replays the first job");
  const changed = await upload(csv([`IMX-${t}`]), key);
  assert.deepEqual([changed.status, changed.code], [409, "IDEMPOTENCY_CONFLICT"], JSON.stringify(changed.json));
  const raceKey = randomUUID();
  const raced = await Promise.all(Array.from({ length: 4 }, () => upload(csv([`IMR-${t}`]), raceKey)));
  const racedIds = new Set(raced.filter((r) => r.status === 201).map((r) => r.json.data.id));
  assert.equal(racedIds.size, 1, raced.map((r) => `${r.status} ${r.code}`).join(","));
  assert.ok(raced.every((r) => r.status === 201 || r.code === "IDEMPOTENCY_IN_PROGRESS"), raced.map((r) => `${r.status} ${r.code}`).join(","));
  assert.equal(await jobsBefore(), start + 2, "two jobs: one per key");

  // 雙擊確認：兩個唔同 key 嘅 confirm 同時入，只有一個排到隊，一行 audit。
  const jobId = first.json.data.id;
  await precheck(jobId);
  const ready = (await h.send(h.users.mgmt, h.route("GET /api/v1/supplier-imports/:id"), { ids: { id: jobId } })).json.data.job;
  assert.equal(ready.status, "ready");
  const confirms = await Promise.all([0, 1].map(() => h.send(h.users.mgmt, h.route("POST /api/v1/supplier-imports/:id/confirm"),
    { ids: { id: jobId }, body: { version: ready.version, activationMode: "draft", approverUserId: null } })));
  assert.deepEqual(confirms.map((r) => r.status).sort(), [200, 409], confirms.map((r) => `${r.status} ${r.code}`).join(","));
  const [confirmAudits] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE target_type = 'import' AND target_id = ? AND action = 'import.confirm'", [jobId]);
  assert.equal(Number(confirmAudits[0].n), 1);

  // 同一個檔用第二個 key：係另一個 job，但執行完 Supplier 唔會重複。
  const second = await upload(file, randomUUID());
  assert.equal(second.status, 201);
  assert.notEqual(second.json.data.id, jobId);
  assert.equal(await execute(jobId), "completed");
  await precheck(second.json.data.id);
  const secondJob = (await h.send(h.users.mgmt, h.route("GET /api/v1/supplier-imports/:id"), { ids: { id: second.json.data.id } })).json.data;
  if (secondJob.job.status === "ready") {
    const confirmed = await h.send(h.users.mgmt, h.route("POST /api/v1/supplier-imports/:id/confirm"),
      { ids: { id: second.json.data.id }, body: { version: secondJob.job.version, activationMode: "draft", approverUserId: null } });
    assert.equal(confirmed.status, 200, confirmed.text);
    await execute(second.json.data.id);
  }
  const [created] = await h.db.query("SELECT id, supplier_code FROM suppliers WHERE supplier_code IN (?, ?)", codes);
  for (const row of created) h.supplierIds.push(Number(row.id));
  assert.deepEqual(created.map((row) => row.supplier_code).sort(), [...codes].sort(), "each imported Supplier exists exactly once");
  const [createAudits] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE action = 'supplier.create' AND target_label IN (?, ?)", codes);
  assert.equal(Number(createAudits[0].n), 2, "one create audit per Supplier");
  const [approvals] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_activation_requests WHERE supplier_id IN (?)", [created.map((row) => row.id)]);
  assert.equal(Number(approvals[0].n), 0, "draft import opens no approval");
});
