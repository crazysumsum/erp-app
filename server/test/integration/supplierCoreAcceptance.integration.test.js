import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { MISSING, createSupplierHarness } from "./supplierHttpHarness.js";

/**
 * TASK-051 step 2b：建立、Code、冪等、樂觀鎖、狀態機同 child ownership（CORE-001/004/008/011、STATE-002/005/007/009、
 * PARTY-006/007），真 app、真 HTTP、真 MySQL。並發 case 用真並發請求或者兩條獨立連線，唔係假 ER_DUP_ENTRY。
 */
const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
const h = Object.assign(createSupplierHarness("core51"), { users: {} });
const REASON = "T51 core acceptance";

before(async () => {
  if (process.env.DB_INTEGRATION_TESTS !== "1") return;
  await h.start();
  h.users.mgmt = await h.makeUser("mgmt", ["supplier.view", "supplier.mgmt"]);
  h.users.approver = await h.makeUser("apr", ["supplier.view", "supplier.approval"]);
  h.users.settings = await h.makeUser("set", ["supplier.settings"]);
  h.users.businessMaster = await h.makeUser("bm", ["business_master.view", "business_master.mgmt"]);
  // 呢度嘅建立同啟用都假設審批關閉（預設值）；之前有測試開咗就喺度關返。
  const settings = (await h.send(h.users.settings, h.route("GET /api/v1/supplier-settings"))).json.data;
  if (settings.requireActivationApproval) {
    const off = await h.send(h.users.settings, h.route("POST /api/v1/supplier-settings/update"),
      { body: { requireActivationApproval: false, version: settings.version, reason: REASON } });
    assert.equal(off.status, 200, off.text);
  }
});

after(() => h.stop());

const tag = () => randomUUID().slice(0, 8).toUpperCase();

async function create(body, options = {}) {
  const response = await h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/create"),
    { body: { defaultCurrencyCode: "HKD", ...body }, ...options });
  if (response.status === 201) h.supplierIds.push(response.json.data.id);
  return response;
}

async function row(id) {
  const [[found]] = await h.db.query("SELECT * FROM suppliers WHERE id = ?", [id]);
  return found;
}

async function audits(id) {
  const [rows] = await h.db.query("SELECT action FROM supplier_audit_logs WHERE supplier_id = ? ORDER BY id", [id]);
  return rows.map((entry) => entry.action);
}

function lifecycle(action, id, body, user = h.users.mgmt) {
  return h.send(user, h.route(`POST /api/v1/suppliers/:id/${action}`), { ids: { id }, body });
}

const updateBody = (version, supplierName, extra = {}) => ({ version, supplierName, displayName: "", defaultCurrencyCode: "HKD",
  defaultPaymentTermId: null, website: "", generalPhone: "", generalEmail: "", notes: "", ...extra });

integrationTest("TC-017 (CORE-001): create makes a Draft at version 1 with its audit and name index, readable at once, and a refused create leaves nothing", async () => {
  const t = tag();
  const made = await create({ supplierCode: `C001-${t}`, supplierName: `Core One ${t}`, displayName: "Core", notes: "first" });
  assert.equal(made.status, 201, made.text);
  const id = made.json.data.id;
  assert.deepEqual([made.json.data.status, made.json.data.version], ["draft", 1]);
  const stored = await row(id);
  assert.deepEqual([stored.status, Number(stored.version), stored.supplier_code, stored.display_name, stored.notes],
    ["draft", 1, `C001-${t}`, "Core", "first"]);
  assert.deepEqual(await audits(id), ["supplier.create"]);
  const [[grams]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_name_grams WHERE supplier_id = ?", [id]);
  assert.ok(Number(grams.n) > 0, "the name search index is written with the row");
  const detail = await h.send(h.users.mgmt, h.route("GET /api/v1/suppliers/:id"), { ids: { id } });
  assert.deepEqual([detail.status, detail.json.data.supplierCode, detail.json.data.version], [200, `C001-${t}`, 1]);

  // 同一個 Code 再建：喺寫入之前已經被預檢拒絕，所以冇嘢留低。呢度唔證明 transaction 原子性（寫入後出錯回滾），
  // 嗰個由 TC-028（supplierManagement.integration）用 audit 失敗證明（REV-097 M-2）。
  const [[before]] = await h.db.query("SELECT (SELECT COUNT(*) FROM supplier_audit_logs) AS audits, (SELECT COUNT(*) FROM supplier_name_grams) AS grams");
  const again = await create({ supplierCode: `c001-${t.toLowerCase()}`, supplierName: `Loser ${t}` });
  assert.deepEqual([again.status, again.code], [409, "SUPPLIER_CODE_TAKEN"]);
  const [[afterwards]] = await h.db.query("SELECT (SELECT COUNT(*) FROM supplier_audit_logs) AS audits, (SELECT COUNT(*) FROM supplier_name_grams) AS grams");
  assert.deepEqual(afterwards, before);
});

integrationTest("TC-020 (CORE-004): Codes are kept exactly as typed, invalid ones are 400, and a normalised duplicate is 409 in every state and in a two-connection race, with nothing half-written", async () => {
  const t = tag();
  const exact = await create({ supplierCode: `acme-${t.toLowerCase()}_01`, supplierName: `Exact ${t}` });
  assert.equal(exact.status, 201, exact.text);
  assert.equal(exact.json.data.supplierCode, `acme-${t.toLowerCase()}_01`, "no prefix, no case change, no generated Code");
  const longest = `L${t}`.padEnd(64, "9");
  assert.equal((await create({ supplierCode: longest, supplierName: `Long ${t}` })).status, 201);

  const before = await h.snapshot();
  for (const [name, code, expected] of [["blank", "   ", "SUPPLIER_CODE_INVALID"], ["control", `X\u0007${t}`, "SUPPLIER_CODE_INVALID"],
    ["65 chars", `M${t}`.padEnd(65, "9"), "REQUEST_VALIDATION_FAILED"], ["empty", "", "REQUEST_VALIDATION_FAILED"]]) {
    const refused = await create({ supplierCode: code, supplierName: `Bad ${t}` });
    assert.deepEqual([refused.status, refused.code], [400, expected], name);
  }
  // 每個狀態都有一個 SUP-…；細楷版本一律 409。
  for (const status of ["draft", "pending_approval", "active", "suspended", "blocked", "archived"]) {
    const code = `SUP-${status.slice(0, 3).toUpperCase()}-${t}`;
    await h.seedSupplier(code, `${status} ${t}`, status);
    const duplicate = await create({ supplierCode: code.toLowerCase(), supplierName: `Dup ${status} ${t}` });
    assert.deepEqual([duplicate.status, duplicate.code], [409, "SUPPLIER_CODE_TAKEN"], status);
  }
  const [[refusedRoots]] = await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_name LIKE ?", [`Bad ${t}`]);
  assert.equal(Number(refusedRoots.n), 0, "no root row from a refused create");
  const afterRefusals = await h.snapshot();
  assert.deepEqual(Object.fromEntries(Object.entries(afterRefusals).filter(([table]) => !table.endsWith(".suppliers"))),
    Object.fromEntries(Object.entries(before).filter(([table]) => !table.endsWith(".suppliers"))), "refusals wrote no audit, grams or children");

  // 兩條連線同時用大細楷唔同嘅同一個 Code 建立：一個 201，其餘 409，冇半份資料。
  const raceCode = `RACE-${t}`;
  const racers = await Promise.all([raceCode, raceCode.toLowerCase(), raceCode, raceCode.toLowerCase()]
    .map((code, index) => create({ supplierCode: code, supplierName: `Racer ${index} ${t}` })));
  assert.equal(racers.filter((r) => r.status === 201).length, 1, racers.map((r) => `${r.status} ${r.code}`).join(","));
  assert.ok(racers.every((r) => r.status === 201 || (r.status === 409 && r.code === "SUPPLIER_CODE_TAKEN")));
  const [[{ n }]] = await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = ?", [raceCode.toLowerCase()]);
  assert.equal(Number(n), 1);
  const [[orphans]] = await h.db.query("SELECT COUNT(*) AS n FROM supplier_audit_logs WHERE target_label LIKE ? AND supplier_id IS NULL", [`Racer % ${t}`]);
  assert.equal(Number(orphans.n), 0);

  // 修改 Code（device＋password）：兩個 Supplier 同時改去同一個 Code，一個成功，一個 409。
  const first = await create({ supplierCode: `CHA-${t}`, supplierName: `Change A ${t}` });
  const second = await create({ supplierCode: `CHB-${t}`, supplierName: `Change B ${t}` });
  const target = `NEW-${t}`;
  const changes = await Promise.all([first, second].map((made, index) => h.send(h.users.mgmt, h.route("POST /api/v1/suppliers/:id/code/change"),
    { ids: { id: made.json.data.id }, body: { supplierCode: index ? target.toLowerCase() : target, reason: REASON, version: 1 } })));
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409], changes.map((r) => r.text).join(" | "));
  assert.equal(changes.find((r) => r.status === 409).code, "SUPPLIER_CODE_TAKEN");
  const loser = [first, second][changes.findIndex((r) => r.status === 409)].json.data.id;
  assert.equal(Number((await row(loser)).version), 1, "the refused change left its Supplier untouched");
});

integrationTest("TC-024 (CORE-008): one Idempotency-Key makes one Supplier whether repeated or raced; a different payload under it is refused; a new key follows the Code rule", async () => {
  const t = tag();
  const body = { supplierCode: `IDEM-${t}`, supplierName: `Idempotent ${t}` };
  const key = randomUUID();
  const first = await create(body, { idempotencyKey: key });
  assert.equal(first.status, 201, first.text);
  const repeat = await create(body, { idempotencyKey: key });
  assert.deepEqual([repeat.status, repeat.json.data], [201, first.json.data], "the repeat replays the first result");
  const changed = await create({ ...body, supplierName: `Other ${t}` }, { idempotencyKey: key });
  assert.deepEqual([changed.status, changed.code], [409, "IDEMPOTENCY_CONFLICT"], changed.text);
  const newKey = await create(body);
  assert.deepEqual([newKey.status, newKey.code], [409, "SUPPLIER_CODE_TAKEN"]);

  // 同一個 key 並發：只得一筆，每個回應都係同一個結果，或者係「仲處理緊」。
  const raced = { supplierCode: `IDEM-RACE-${t}`, supplierName: `Raced ${t}` };
  const raceKey = randomUUID();
  const responses = await Promise.all(Array.from({ length: 6 }, () => create(raced, { idempotencyKey: raceKey })));
  const created = responses.filter((r) => r.status === 201);
  assert.ok(created.length >= 1, responses.map((r) => `${r.status} ${r.code}`).join(","));
  assert.ok(created.every((r) => r.json.data.id === created[0].json.data.id), "every 201 is the same Supplier");
  assert.ok(responses.every((r) => r.status === 201 || r.code === "IDEMPOTENCY_IN_PROGRESS"), responses.map((r) => `${r.status} ${r.code}`).join(","));
  const replay = await create(raced, { idempotencyKey: raceKey });
  assert.deepEqual(replay.json.data, created[0].json.data);
  const [[{ n }]] = await h.db.query("SELECT COUNT(*) AS n FROM suppliers WHERE supplier_code_key = ?", [raced.supplierCode.toLowerCase()]);
  assert.equal(Number(n), 1);
  assert.deepEqual(await audits(created[0].json.data.id), ["supplier.create"]);
});

integrationTest("TC-027 (CORE-011): a stale version is 409 VERSION_CONFLICT; of two concurrent saves exactly one wins and its fields are stored whole", async () => {
  const t = tag();
  const made = await create({ supplierCode: `LOCK-${t}`, supplierName: `Lock ${t}` });
  const id = made.json.data.id;
  const update = h.route("POST /api/v1/suppliers/:id/update");
  const a = await h.send(h.users.mgmt, update, { ids: { id }, body: updateBody(1, `A ${t}`, { notes: "from A" }) });
  assert.equal(a.status, 200, a.text);
  const b = await h.send(h.users.mgmt, update, { ids: { id }, body: updateBody(1, `B ${t}`, { website: "https://b.example" }) });
  assert.deepEqual([b.status, b.code], [409, "VERSION_CONFLICT"]);
  let stored = await row(id);
  assert.deepEqual([stored.supplier_name, stored.notes, stored.website, Number(stored.version)], [`A ${t}`, "from A", "", 2]);

  for (let round = 0; round < 5; round += 1) {
    const version = Number((await row(id)).version);
    const payloads = [updateBody(version, `X${round} ${t}`, { notes: `x${round}`, generalPhone: "111" }),
      updateBody(version, `Y${round} ${t}`, { notes: `y${round}`, website: "https://y.example" })];
    const results = await Promise.all(payloads.map((body) => h.send(h.users.mgmt, update, { ids: { id }, body })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => `${r.status} ${r.code}`).join(","));
    assert.equal(results.find((r) => r.status === 409).code, "VERSION_CONFLICT");
    const winner = payloads[results.findIndex((r) => r.status === 200)];
    stored = await row(id);
    assert.deepEqual([stored.supplier_name, stored.notes, stored.general_phone, stored.website, Number(stored.version)],
      [winner.supplierName, winner.notes, winner.generalPhone ?? "", winner.website ?? "", version + 1], "no field from the loser");
  }
  assert.equal((await audits(id)).filter((action) => action === "supplier.update").length, 6, "one audit per successful save");
});

integrationTest("TC-031 (STATE-002): reactivate makes a complete Supplier Active even without optional data, and refuses an incomplete one with 422 while it stays Suspended", async () => {
  const t = tag();
  const complete = await h.seedSupplier(`RE-OK-${t}`, `Complete ${t}`, "suspended");
  const ok = await lifecycle("reactivate", complete, { version: 1, reason: REASON });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([(await row(complete)).status, Number((await row(complete)).version)], ["active", 2]);

  const incomplete = await h.seedSupplier(`RE-NO-${t}`, "", "suspended");
  const refused = await lifecycle("reactivate", incomplete, { version: 1, reason: REASON });
  assert.deepEqual([refused.status, refused.code], [422, "SUPPLIER_NOT_ACTIVATABLE"], refused.text);
  assert.deepEqual(refused.json.error.details.issues.map((issue) => issue.field), ["supplierName"], "the issue names the missing field");
  const stored = await row(incomplete);
  assert.deepEqual([stored.status, Number(stored.version)], ["suspended", 1]);
  assert.deepEqual(await audits(incomplete), []);
});

integrationTest("TC-034 (STATE-005): an archived Supplier is hidden by default, found by explicit filter, restores to Suspended, and stays unusable for new purchases", async () => {
  const t = tag();
  const made = await create({ supplierCode: `ARC-${t}`, supplierName: `Archive ${t}`, activate: true });
  const id = made.json.data.id;
  assert.equal(made.json.data.status, "active");
  const archived = await lifecycle("archive", id, { version: made.json.data.version, reason: REASON });
  assert.equal(archived.status, 200, archived.text);

  const list = (search) => h.send(h.users.mgmt, { ...h.route("GET /api/v1/suppliers"), path: `/api/v1/suppliers?q=${encodeURIComponent(`ARC-${t}`)}${search}` });
  assert.equal((await list("")).json.data.total, 0, "hidden from the default list");
  assert.deepEqual((await list("&includeArchived=true")).json.data.items.map((item) => [item.id, item.status]), [[id, "archived"]]);
  assert.deepEqual((await list("&status=archived&includeArchived=true")).json.data.items.map((item) => item.id), [id]);

  const provider = h.application.services.require("supplierCoreProvider");
  await assert.rejects(provider.assertUsable(id, { purpose: "purchase" }), (error) => error.publicCode === "SUPPLIER_NOT_USABLE");
  assert.equal((await provider.findById(id, { purpose: "history" })).status, "archived", "history still reads it");

  const restored = await lifecycle("restore", id, { version: archived.json.data.version, reason: REASON });
  assert.equal(restored.status, 200, restored.text);
  assert.equal((await row(id)).status, "suspended", "restore lands on Suspended, not Active");
  await assert.rejects(provider.assertUsable(id, { purpose: "purchase" }), (error) => error.publicCode === "SUPPLIER_NOT_USABLE");
  assert.ok((await list("")).json.data.items.some((item) => item.id === id), "back in the default list");
  assert.deepEqual((await audits(id)).slice(-2), ["supplier.archive", "supplier.restore"]);
});

integrationTest("TC-036 (STATE-007): a purchase transaction's FOR UPDATE serialises a concurrent status change in either order, a stale screen is re-checked, and an unknown status fails the impact check closed", async () => {
  const t = tag();
  const provider = h.application.services.require("supplierCoreProvider");
  const made = await create({ supplierCode: `PO-${t}`, supplierName: `Purchase ${t}`, activate: true });
  const id = made.json.data.id;

  // A 先：connection A 喺 purchase transaction 鎖住；B 嘅 suspend 要等 A commit 先完成。
  let locked;
  const isLocked = new Promise((resolve) => { locked = resolve; });
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const order = [];
  const purchase = h.db.withTransaction(async (connection) => {
    const supplier = await provider.assertUsableInTransaction(connection, id, { purpose: "purchase" });
    assert.equal(supplier.status, "active");
    locked();
    await released;
    order.push("purchase committed");
  });
  await isLocked;
  let suspend;
  try {
    suspend = lifecycle("suspend", id, { version: made.json.data.version, reason: REASON }).then((response) => { order.push("suspend answered"); return response; });
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    assert.deepEqual(order, [], "the status change is waiting on the purchase lock");
  } finally {
    // 斷言失敗都要放鎖，唔係 after() 刪唔到行，成個 process 會吊住（REV-097 M-1）。
    release();
    await purchase.catch(() => {});
  }
  assert.equal((await suspend).status, 200);
  assert.deepEqual(order, ["purchase committed", "suspend answered"]);

  // B 先，而且仲揸住鎖：connection B 鎖住並改咗狀態未 commit；A 已經有 snapshot，佢嘅 FOR UPDATE 要等 B，
  // 之後讀到 B commit 咗嘅狀態而拒絕（REV-097 L-1）。冇 FOR UPDATE 嘅話 A 會讀到舊 snapshot 嘅 active。
  const held = await create({ supplierCode: `PO3-${t}`, supplierName: `Purchase Three ${t}`, activate: true });
  const heldId = held.json.data.id;
  let bLocked;
  const bIsLocked = new Promise((resolve) => { bLocked = resolve; });
  let bRelease;
  const bReleased = new Promise((resolve) => { bRelease = resolve; });
  const steps = [];
  const statusChange = h.db.withTransaction(async (connection) => {
    await connection.query("SELECT id FROM suppliers WHERE id = ? FOR UPDATE", [heldId]);
    await connection.query("UPDATE suppliers SET status = 'suspended', version = version + 1 WHERE id = ?", [heldId]);
    bLocked();
    await bReleased;
    steps.push("status change committed");
  });
  let purchaseAfter;
  try {
    await bIsLocked;
    purchaseAfter = h.db.withTransaction(async (connection) => {
      await connection.query("SELECT status FROM suppliers WHERE id = ?", [heldId]);
      await provider.assertUsableInTransaction(connection, heldId, { purpose: "purchase" });
      steps.push("purchase opened");
    }).catch((error) => { steps.push(`purchase refused ${error.publicCode}`); });
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    assert.deepEqual(steps, [], "the purchase check waits for the held status change");
  } finally {
    bRelease();
    await statusChange.catch(() => {});
  }
  await purchaseAfter;
  assert.deepEqual(steps, ["status change committed", "purchase refused SUPPLIER_NOT_USABLE"]);

  // B 先而且已經 commit：重驗拒絕，唔會開到新交易。舊畫面（之前 lookup 係 usable）一樣。
  const other = await create({ supplierCode: `PO2-${t}`, supplierName: `Purchase Two ${t}`, activate: true });
  const otherId = other.json.data.id;
  assert.equal((await provider.findById(otherId, { purpose: "purchase" })).usable, true, "the screen loaded while usable");
  const blocked = await h.send(h.users.approver, h.route("POST /api/v1/suppliers/:id/block"), { ids: { id: otherId }, body: { version: other.json.data.version, reason: REASON } });
  assert.equal(blocked.status, 200, blocked.text);
  let opened = false;
  await assert.rejects(h.db.withTransaction(async (connection) => {
    await provider.assertUsableInTransaction(connection, otherId, { purpose: "purchase" });
    opened = true;
  }), (error) => error.publicCode === "SUPPLIER_NOT_USABLE");
  assert.equal(opened, false);
  assert.equal((await provider.findById(otherId, { purpose: "history" })).status, "blocked", "history still reads it");

  // 未知 status：impact checker 唔可以低報，要 fail closed（直接叫同經 Business Master preview）。
  const mystery = await h.seedSupplier(`MYS-${t}`, `Mystery ${t}`, "mystery");
  try {
    const checker = h.application.services.require("supplierBusinessMasterImpactChecker");
    await assert.rejects(checker.check({ entityType: "CURRENCY", entityKey: "HKD" }), /unclassified status/u);
    const [[currency]] = await h.db.query("SELECT version FROM currencies WHERE code = 'HKD'");
    const preview = await h.send(h.users.businessMaster, { method: "POST", path: "/api/v1/business-master/currencies/HKD/impact-preview",
      authType: "jwt", idempotent: true }, { body: { operation: "DEACTIVATE", version: Number(currency.version), proposedChange: {} } });
    assert.deepEqual([preview.status, preview.code], [503, "IMPACT_CHECK_UNAVAILABLE"], preview.text);
    assert.ok(!/Count"/u.test(preview.text), "no counts are reported");
  } finally {
    await h.db.execute("UPDATE suppliers SET status = 'archived' WHERE id = ?", [mystery]);
  }
});

integrationTest("TC-038 (STATE-009): concurrent transitions on one version produce one legal sequence: one 200, one 409, one audit and a matching final state", async () => {
  const t = tag();
  const pairs = [
    ["suspend", "archive", h.users.mgmt, h.users.mgmt, { suspend: "suspended", archive: "archived" }],
    ["suspend", "block", h.users.mgmt, h.users.approver, { suspend: "suspended", block: "blocked" }],
    ["archive", "block", h.users.mgmt, h.users.approver, { archive: "archived", block: "blocked" }]
  ];
  for (const [round, [left, right, leftUser, rightUser, targets]] of [...pairs, ...pairs].entries()) {
    const made = await create({ supplierCode: `CC${round}-${t}`, supplierName: `Concurrent ${round} ${t}`, activate: true });
    const id = made.json.data.id;
    const version = made.json.data.version;
    const results = await Promise.all([[left, leftUser], [right, rightUser]]
      .map(([action, user]) => lifecycle(action, id, { version, reason: REASON }, user)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], `${left}/${right}: ${results.map((r) => `${r.status} ${r.code}`).join(",")}`);
    assert.ok(["VERSION_CONFLICT", "STATUS_TRANSITION_INVALID"].includes(results.find((r) => r.status === 409).code));
    const winner = [left, right][results.findIndex((r) => r.status === 200)];
    const stored = await row(id);
    assert.deepEqual([stored.status, Number(stored.version)], [targets[winner], version + 1]);
    assert.deepEqual((await audits(id)).slice(1), [`supplier.${winner}`], "one audit, the winner's");
  }
});

integrationTest("TC-045 (PARTY-006): another Supplier's route cannot read, update, deactivate or delete a child, answers as for a missing one, and changes nothing", async () => {
  const t = tag();
  const owner = await create({ supplierCode: `OWN-${t}`, supplierName: `Owner ${t}` });
  const intruder = await create({ supplierCode: `INT-${t}`, supplierName: `Intruder ${t}` });
  const [ownerId, intruderId] = [owner.json.data.id, intruder.json.data.id];
  const childCreate = (kind, body) => h.send(h.users.mgmt, h.route(`POST /api/v1/suppliers/:supplierId/${kind}/create`), { ids: { supplierId: ownerId }, body });
  const address = (await childCreate("addresses", { label: "HQ", purposes: [] })).json.data;
  const contact = (await childCreate("contacts", { name: "Amy", purposes: [] })).json.data;
  const identifier = (await childCreate("identifiers", { identifierType: "business_registration", issuerCountryCode: "HK", identifierValue: `BR${t}` })).json.data;
  assert.ok(address?.id && contact?.id && identifier?.id, "children created");

  const snapshotOwner = async () => {
    const [rows] = await h.db.query(
      `SELECT 'a' AS k, id, version, status, label AS v FROM supplier_addresses WHERE supplier_id = ?
       UNION ALL SELECT 'c', id, version, status, name FROM supplier_contacts WHERE supplier_id = ?
       UNION ALL SELECT 'i', id, version, '', identifier_value FROM supplier_identifiers WHERE supplier_id = ?
       UNION ALL SELECT 'audit', COUNT(*), 0, '', '' FROM supplier_audit_logs WHERE supplier_id IN (?, ?)`, [ownerId, ownerId, ownerId, ownerId, intruderId]);
    return JSON.stringify(rows);
  };
  const before = await snapshotOwner();
  const attempts = [
    ["addresses/:addressId/update", "addressId", address.id, { version: address.version, label: "Taken", purposes: [] }, "SUPPLIER_ADDRESS_NOT_FOUND"],
    ["addresses/:addressId/deactivate", "addressId", address.id, { version: address.version }, "SUPPLIER_ADDRESS_NOT_FOUND"],
    ["contacts/:contactId/update", "contactId", contact.id, { version: contact.version, name: "Taken", purposes: [] }, "SUPPLIER_CONTACT_NOT_FOUND"],
    ["contacts/:contactId/deactivate", "contactId", contact.id, { version: contact.version }, "SUPPLIER_CONTACT_NOT_FOUND"],
    ["identifiers/:identifierId/update", "identifierId", identifier.id, { version: identifier.version, identifierType: "business_registration",
      issuerCountryCode: "HK", identifierValue: `TAKEN${t}`, reason: REASON }, "SUPPLIER_IDENTIFIER_NOT_FOUND"],
    ["identifiers/:identifierId/delete", "identifierId", identifier.id, { version: identifier.version, reason: REASON }, "SUPPLIER_IDENTIFIER_NOT_FOUND"]
  ];
  for (const [suffix, param, childId, body, code] of attempts) {
    const r = h.route(`POST /api/v1/suppliers/:supplierId/${suffix}`);
    const foreign = await h.send(h.users.mgmt, r, { ids: { supplierId: intruderId, [param]: childId }, body });
    const missing = await h.send(h.users.mgmt, r, { ids: { supplierId: intruderId, [param]: MISSING }, body });
    assert.deepEqual([foreign.status, foreign.code], [404, code], `${suffix}: ${foreign.text}`);
    assert.deepEqual([foreign.status, foreign.code, foreign.message], [missing.status, missing.code, missing.message], `${suffix} discloses nothing`);
  }
  // 讀：B 嘅 detail 同 child 清單唔會出現 A 嘅 child。
  const intruderDetail = await h.send(h.users.mgmt, h.route("GET /api/v1/suppliers/:id"), { ids: { id: intruderId } });
  const intruderAddresses = await h.send(h.users.mgmt, h.route("GET /api/v1/suppliers/:id/addresses"), { ids: { id: intruderId } });
  const intruderContacts = await h.send(h.users.mgmt, h.route("GET /api/v1/suppliers/:id/contacts"), { ids: { id: intruderId } });
  assert.deepEqual([intruderDetail.json.data.addresses, intruderDetail.json.data.contacts, intruderDetail.json.data.identifiers], [[], [], []]);
  assert.deepEqual([intruderAddresses.json.data.total, intruderContacts.json.data.total], [0, 0]);
  assert.equal(await snapshotOwner(), before, "the owner's children and both Suppliers' audit are unchanged");
});

integrationTest("TC-046 (PARTY-007): a Draft with only the three minimum fields gets warnings but no issues, and activates", async () => {
  const t = tag();
  const made = await create({ supplierCode: `MIN-${t}`, supplierName: `Minimum ${t}` });
  const id = made.json.data.id;
  const completeness = await h.send(h.users.mgmt, h.route("GET /api/v1/suppliers/:id/completeness"), { ids: { id } });
  assert.equal(completeness.status, 200, completeness.text);
  assert.deepEqual(completeness.json.data.issues, []);
  assert.deepEqual(completeness.json.data.warnings.map((w) => w.code).sort(),
    ["IDENTIFIER_MISSING", "ORDERING_ADDRESS_MISSING", "ORDERS_CONTACT_MISSING", "PAYMENT_TERM_MISSING"]);
  const activated = await lifecycle("activate", id, { version: 1 });
  assert.equal(activated.status, 200, activated.text);
  assert.equal((await row(id)).status, "active");
});
