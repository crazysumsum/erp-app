/**
 * HD-019：PO 表單 lookup 經真 HTTP、真 JWT 同真 MySQL（設計 §5.5）。重點係只有 purchasing.mgmt 都用得（六個權限互不繼承），
 * 同埋資格由 provider 決定。資料已 commit，所以全部用 tag 搜尋，唔假設 DB 入面冇其他資料；完咗刪走。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createApplication } from "../../src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../src/framework/configuration/applicationConfiguration.js";
import { purchasingLookupService } from "../../src/handlers/purchasing/purchasingSchemas.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

async function setup(t) {
  const source = defaultConfigurationSource();
  const application = await createApplication({ configurationSource: { ...source, application: { ...source.application, port: 0 } } });
  const db = application.services.require("mysqldatabase"), jwt = application.services.require("jwt");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12), now = Date.now(), cleanup = [];
  const insert = async (table, row) => {
    const id = Number((await db.query(`INSERT INTO ${table} SET ?`, [row]))[0].insertId);
    cleanup.push([table, "id", id]);
    return id;
  };
  t.after(async () => {
    try { for (const [table, column, id] of cleanup.reverse()) await db.query(`DELETE FROM ${table} WHERE ${column} = ?`, [id]); }
    finally { await application.shutdown("purchasing_lookup_integration_complete"); }
  });

  const actor = async (suffix, permission, user = {}) => {
    const name = `po_lookup_${suffix}_${tag}`;
    const role = await insert("roles", { name, created_at: now });
    await db.query("INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE name = ?", [role, permission]);
    cleanup.push(["role_permissions", "role_id", role]);
    const id = await insert("users", { username: name, password_hash: "synthetic", display_name: "", created_at: now, updated_at: now, ...user });
    await db.query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [id, role]);
    cleanup.push(["user_roles", "user_id", id], ["fr_token_versions", "subject", String(id)]);
    const version = await application.services.require("tokenRevocation").currentVersion(String(id));
    const token = await jwt.issue({ roles: [name], permissions: [permission] }, { subject: String(id), version, authTime: Math.floor(now / 1000) });
    return { id, role, token, name };
  };
  const buyer = await actor("mgmt", "purchasing.mgmt", { display_name: "Alice Buyer" });
  const plain = await actor("plain", "purchasing.mgmt");
  const viewer = await actor("view", "purchasing.view");
  const stopped = await actor("stopped", "purchasing.mgmt", { status: "disabled" });

  const term = await insert("payment_terms", { code: `PT${tag}`, code_key: `pt${tag}`, name: `Net ${tag}`, calculation_type: "NET_DAYS", due_days: 30, status: "ACTIVE", version: 1, created_at: now, updated_at: now });
  const stoppedTerm = await insert("payment_terms", { code: `PX${tag}`, code_key: `px${tag}`, name: `Old ${tag}`, calculation_type: "NET_DAYS", due_days: 30, status: "INACTIVE", version: 1, created_at: now, updated_at: now });
  const supplier = (code, row = {}) => insert("suppliers", { supplier_code: `${code}-${tag}`, supplier_code_key: `${code}-${tag}`.toLowerCase(), supplier_name: `Name ${tag} ${code}`,
    supplier_name_key: `name ${tag} ${code}`.toLowerCase(), display_name: `Name ${tag} ${code}`, default_currency_code: "HKD", status: "active", created_at: now, updated_at: now, ...row });
  const suppliers = { main: await supplier("SA", { default_payment_term_id: term }), other: await supplier("SB"), stopped: await supplier("SC", { status: "inactive" }),
    badTerm: await supplier("SD", { default_payment_term_id: stoppedTerm }),
    // 名稱排先過 SA，但 code 只係前綴相符：完全相符嘅 SA 要排先。
    longer: await supplier(`SA-${tag}`, { supplier_name: `AAA ${tag}`, supplier_name_key: `aaa ${tag}`, display_name: `AAA ${tag}` }) };
  const address = await insert("supplier_addresses", { supplier_id: suppliers.main, label: "HQ", address_line1: "1 Probe Road", city: "Hong Kong", country_code: "HK", phone: "+852", notes: "internal", created_at: now, updated_at: now });
  await db.query("INSERT INTO supplier_address_purposes (address_id, supplier_id, purpose_code, is_primary, created_at, updated_at) VALUES (?, ?, 'ordering', 1, ?, ?)", [address, suppliers.main, now, now]);
  cleanup.splice(cleanup.findIndex(([table]) => table === "supplier_addresses") + 1, 0, ["supplier_address_purposes", "address_id", address]);

  const item = await insert("items", { name: `Item ${tag}`, status: "active", created_at: now, updated_at: now });
  const uom = await insert("item_uoms", { code: `E${tag}`, name: "Each", created_at: now, updated_at: now });
  const pack = await insert("item_uoms", { code: `P${tag}`, name: "Pack", created_at: now, updated_at: now });
  const closedUom = await insert("item_uoms", { code: `X${tag}`, name: "Closed", status: "inactive", created_at: now, updated_at: now });
  const sku = async (code, row = {}) => {
    const id = await insert("item_skus", { item_id: item, sku_code: `${code}-${tag}`, sku_name: `Sku ${code}`, status: "active", created_at: now, updated_at: now, ...row });
    const mapping = await insert("item_sku_uoms", { sku_id: id, uom_id: uom, to_base_factor: 1, is_base: 1, created_at: now, updated_at: now });
    return { id, mapping };
  };
  const skus = { main: await sku("KA", { tracking_policy: "batch" }), untracked: await sku("KB", { inventory_tracked: 0 }), serial: await sku("KC", { tracking_policy: "serial" }), stopped: await sku("KD", { purchasable: 0 }) };
  const packMapping = await insert("item_sku_uoms", { sku_id: skus.main.id, uom_id: pack, to_base_factor: 12, is_default_purchase: 1, created_at: now, updated_at: now });
  await insert("item_sku_uoms", { sku_id: skus.main.id, uom_id: closedUom, to_base_factor: 6, created_at: now, updated_at: now });
  await insert("item_sku_barcodes", { sku_id: skus.main.id, sku_uom_id: skus.main.mapping, barcode_type: "internal", barcode: `B${tag}`, normalized_barcode: `B${tag}`, created_at: now, updated_at: now });
  await insert("item_sku_barcodes", { sku_id: skus.untracked.id, sku_uom_id: skus.untracked.mapping, barcode_type: "internal", barcode: `U${tag}`, normalized_barcode: `U${tag}`, created_at: now, updated_at: now });

  await insert("item_sku_barcodes", { sku_id: skus.stopped.id, sku_uom_id: skus.stopped.mapping, barcode_type: "internal", barcode: `S${tag}`, normalized_barcode: `S${tag}`, created_at: now, updated_at: now });

  const warehouse = await insert("inventory_warehouses", { warehouse_code: `W${tag}`, normalized_code: `w${tag}`, warehouse_name: `Depot ${tag}`, status: "ACTIVE", version: 1, created_by: buyer.id, updated_by: buyer.id, created_at: now, updated_at: now });
  await insert("inventory_warehouses", { warehouse_code: `X${tag}`, normalized_code: `x${tag}`, warehouse_name: `Depot ${tag}`, status: "INACTIVE", version: 1, created_by: buyer.id, updated_by: buyer.id, created_at: now, updated_at: now });

  const { url } = await application.start();
  const get = async (path, token = buyer.token) => {
    const response = await fetch(`${url}/api/v1/purchasing-lookups/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, body: await response.json() };
  };
  const lookup = purchasingLookupService(application.services, application.services.require("logging").logger);
  return { db, get, lookup, tag, buyer, plain, viewer, stopped, suppliers, skus, packMapping, term, stoppedTerm, address, warehouse };
}

const invalid = (result, field) => {
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "PURCHASING_INPUT_INVALID");
  assert.deepEqual(result.body.error.details, { field });
};
const conflict = (result, code, field) => {
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  if (field) assert.deepEqual(result.body.error.details, { field });
};

const pathsFor = ({ suppliers }) => ["suppliers", `suppliers/${suppliers.main}/defaults`, "skus", "currencies", "payment-terms", "warehouses", "buyers"];

integrationTest("七條 lookup 只要 purchasing.mgmt；purchasing.view 403、冇 token 401", async (t) => {
  const context = await setup(t), { get, viewer } = context;
  for (const path of pathsFor(context)) {
    const allowed = await get(path);
    assert.equal(allowed.status, 200, `${path}: ${JSON.stringify(allowed.body)}`);
    assert.equal((await get(path, viewer.token)).status, 403, path);
  }
  assert.equal((await get("suppliers", null)).status, 401);
  // Service 唔信 handler：就算 token 同 DB 一致，冇 purchasing.mgmt 都唔讀。
  await assert.rejects(context.lookup.warehouses({ claims: { sub: String(viewer.id), roles: [viewer.name], permissions: ["purchasing.view"] } }),
    (error) => error.code === "PERMISSION_STALE");
});

// 分開一個 application：連續 403 會觸發 rate limit。
integrationTest("DB 權限收走之後，七條 lookup 都係 PERMISSION_STALE", async (t) => {
  const context = await setup(t), { db, get, buyer } = context;
  await db.query("DELETE FROM role_permissions WHERE role_id = ?", [buyer.role]);
  for (const path of pathsFor(context)) {
    const stale = await get(path);
    assert.equal(stale.status, 403, path);
    assert.equal(stale.body.error.code, "PERMISSION_STALE", path);
  }
});

integrationTest("Supplier 只回 Active：完全相符嘅 code 排先、% 係字面、非 ASCII 唔會 500；帶 skuId 用 provider，SKU 唔可採購就 409", async (t) => {
  const { get, tag, suppliers, skus } = await setup(t);
  const named = await get(`suppliers?q=${encodeURIComponent(`Name ${tag}`)}`);
  assert.equal(named.status, 200, JSON.stringify(named.body));
  assert.deepEqual(named.body.data.items.map((row) => row.supplierId), [suppliers.main, suppliers.other, suppliers.badTerm]);
  assert.deepEqual(named.body.data.items[0], { supplierId: suppliers.main, supplierCode: `SA-${tag}`, supplierName: `Name ${tag} SA`, displayName: `Name ${tag} SA`,
    defaultCurrencyCode: "HKD", defaultPaymentTermId: named.body.data.items[0].defaultPaymentTermId });

  assert.deepEqual((await get(`suppliers?q=sb-${tag}`)).body.data.items.map((row) => row.supplierId), [suppliers.other]);
  assert.deepEqual((await get(`suppliers?q=${encodeURIComponent(` sb-${tag} `)}`)).body.data.items.map((row) => row.supplierId), [suppliers.other]);
  assert.deepEqual((await get(`suppliers?q=sa-${tag}`)).body.data.items.map((row) => row.supplierId), [suppliers.main, suppliers.longer]);
  assert.deepEqual((await get(`suppliers?q=${encodeURIComponent(`%${tag}`)}`)).body.data.items, []);
  assert.deepEqual((await get(`suppliers?q=${encodeURIComponent("供應商")}`)).status, 200);

  const forSku = await get(`suppliers?q=${encodeURIComponent(`Name ${tag}`)}&skuId=${skus.main.id}`);
  assert.equal(forSku.status, 200, JSON.stringify(forSku.body));
  assert.deepEqual(new Set(forSku.body.data.items.map((row) => row.supplierId)), new Set([suppliers.main, suppliers.other, suppliers.badTerm]));
  conflict(await get(`suppliers?skuId=${skus.stopped.id}`), "SKU_NOT_PURCHASABLE", "skuId");
  conflict(await get("suppliers?skuId=999999999"), "SKU_NOT_PURCHASABLE", "skuId");

  invalid(await get("suppliers?skuId=abc"), "skuId");
  invalid(await get("suppliers?other=1"), "query");
});

integrationTest("Supplier 預設值帶 Currency、Payment Term、主要地址，唔帶內部 notes；停用 Supplier 同失效預設各有錯誤碼", async (t) => {
  const { get, tag, suppliers, term, address } = await setup(t);
  const main = await get(`suppliers/${suppliers.main}/defaults`);
  assert.equal(main.status, 200, JSON.stringify(main.body));
  assert.deepEqual(main.body.data, { supplierId: suppliers.main, currency: main.body.data.currency,
    paymentTerm: { id: term, code: `PT${tag}`, name: `Net ${tag}`, calculationType: "NET_DAYS", dueDays: 30 },
    orderingAddress: { id: address, addressLine1: "1 Probe Road", addressLine2: "", addressLine3: "", city: "Hong Kong", stateRegion: "", postalCode: "", countryCode: "HK", phone: "+852" } });
  assert.equal(main.body.data.currency.code, "HKD");
  assert.equal(typeof main.body.data.currency.decimalPlaces, "number");

  const plain = await get(`suppliers/${suppliers.other}/defaults`);
  assert.deepEqual([plain.body.data.paymentTerm, plain.body.data.orderingAddress], [null, null]);

  conflict(await get(`suppliers/${suppliers.stopped}/defaults`), "SUPPLIER_NOT_PURCHASABLE", "supplierId");
  conflict(await get("suppliers/999999999/defaults"), "SUPPLIER_NOT_PURCHASABLE", "supplierId");
  conflict(await get(`suppliers/${suppliers.badTerm}/defaults`), "PAYMENT_TERM_NOT_ACTIVE");
});

integrationTest("SKU 只回儲存會接受嘅：冇 tracked、serial、唔可採購都唔出；UOM 只出 active，barcode 精確搵", async (t) => {
  const { get, tag, skus, packMapping } = await setup(t);
  const byTag = await get(`skus?q=${encodeURIComponent(`Item ${tag}`)}`);
  assert.deepEqual(byTag.body.data.items.map((row) => row.skuId), [skus.main.id]);
  const [sku] = byTag.body.data.items;
  assert.deepEqual({ ...sku, uoms: sku.uoms.map((uom) => uom.skuUomId) }, { skuId: skus.main.id, skuCode: `KA-${tag}`, skuName: "Sku KA", itemName: `Item ${tag}`,
    inventoryTracked: true, trackingPolicy: "batch", minimumReceiptLifeDays: null, baseUomCode: `E${tag}`, uoms: [skus.main.mapping, packMapping] });
  assert.deepEqual(sku.uoms[1], { skuUomId: packMapping, uomCode: `P${tag}`, uomName: "Pack", toBaseFactor: 12, isBase: false, isDefaultPurchase: true });

  assert.deepEqual((await get(`skus?barcode=B${tag}`)).body.data.items.map((row) => row.skuId), [skus.main.id]);
  assert.deepEqual((await get(`skus?barcode=U${tag}`)).body.data.items, []);
  assert.deepEqual((await get(`skus?barcode=S${tag}`)).body.data.items, []);
  assert.deepEqual((await get("skus?barcode=no-such-barcode")).body.data.items, []);
  invalid(await get(`skus?q=${encodeURIComponent("a\u0007")}`), "q");
});

integrationTest("Currency、Payment Term、Warehouse 只回 Active；Buyer 係 Active 而有 purchasing.mgmt，只回 ID 同 label", async (t) => {
  const { get, tag, term, stoppedTerm, warehouse, buyer, plain, viewer, stopped } = await setup(t);
  const currencies = (await get("currencies")).body.data.items;
  assert.ok(currencies.some((row) => row.code === "HKD"));
  assert.deepEqual(Object.keys(currencies[0]).sort(), ["code", "decimalPlaces", "name"]);
  const terms = (await get("payment-terms")).body.data.items;
  assert.ok(terms.some((row) => row.id === term));
  assert.ok(!terms.some((row) => row.id === stoppedTerm));

  assert.deepEqual((await get(`warehouses?q=${encodeURIComponent(`Depot ${tag}`)}`)).body.data.items, [{ id: warehouse, code: `W${tag}`, name: `Depot ${tag}` }]);

  const buyers = (await get(`buyers?q=po_lookup_`)).body.data.items.filter((row) => [buyer.id, plain.id, viewer.id, stopped.id].includes(row.id));
  assert.deepEqual(buyers, [{ id: buyer.id, label: "Alice Buyer" }, { id: plain.id, label: plain.name }]);
  assert.deepEqual((await get("buyers?q=Alice")).body.data.items.filter((row) => row.id === buyer.id), [{ id: buyer.id, label: "Alice Buyer" }]);
  assert.deepEqual((await get(`buyers?q=${encodeURIComponent("%lookup")}`)).body.data.items, []);
  assert.ok((await get("buyers")).body.data.items.some((row) => row.id === buyer.id));
});
