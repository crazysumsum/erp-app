import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { SalesOrderService } from "../../src/modules/sales/SalesOrderService.js";
import { setup, stock } from "../sales/phase2/fixtures.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Sales report and CSV show the same confirmed order lines, filters and permissions", async t => {
  const f = await setup(t);
  const [[customer]] = await f.db.query("SELECT customer_code FROM customers WHERE id=?", [f.customerId]);
  const [[sku]] = await f.db.query("SELECT sku_code FROM item_skus WHERE id=?", [f.skuId]);
  const unsafeName = "=SYNTHETIC SKU";
  await f.db.execute("UPDATE item_skus SET sku_name=? WHERE id=?", [unsafeName, f.skuId]);
  const units = { created_at: f.now, updated_at: f.now };
  const secondCode = "report-" + randomUUID();
  const secondSkuId = await f.insert("item_skus", {
    item_id: f.itemId, sku_code: secondCode, sku_name: "Second synthetic", status: "active", sellable: 1, ...units
  });
  const secondUomCode = "box-" + randomUUID().slice(0, 8);
  const secondUomId = await f.insert("item_uoms", { code: secondUomCode, name: "Synthetic box", status: "active", ...units });
  const secondSkuUomId = await f.insert("item_sku_uoms", {
    sku_id: secondSkuId, uom_id: secondUomId, to_base_factor: 1, is_base: 1, is_default_sale: 1, ...units
  });
  await stock(f, 0);
  await stock(f, 0, secondSkuId);

  const date = f.time.fileDate();
  const dayOffset = days => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
  const { salesOrder } = await new SalesOrderService(f).create({
    claims: f.claims,
    input: { eventId: randomUUID(), customerId: f.customerId, currencyCode: f.currency, fulfillmentWarehouseId: f.warehouseId,
      orderDate: date, lines: [
        { skuId: f.skuId, skuUomId: f.skuUomId, quantity: "2", unitSellingPrice: "1.2500" },
        { skuId: secondSkuId, skuUomId: secondSkuUomId, quantity: "4", unitSellingPrice: "3.0000" }
      ] }
  });
  await f.service().confirm({ claims: f.claims, id: salesOrder.id, input: { eventId: randomUUID(), version: 1 } });

  const { url } = await f.app.start();
  const token = await f.app.services.require("jwt").issue({ roles: f.claims.claimedRoles, permissions: f.claims.claimedPermissions }, {
    subject: String(f.userId), version: await f.app.services.require("tokenRevocation").currentVersion(String(f.userId)),
    authTime: Math.floor(f.now / 1000)
  });
  const query = new URLSearchParams({ dateFrom: date, dateTo: date, customerCode: customer.customer_code });
  const request = (path, { auth = true } = {}) => fetch(url + path, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  const report = "/api/v1/sales-reports/orders";
  const view = async params => {
    const response = await request(`${report}?${params}`);
    assert.equal(response.status, 200);
    return (await response.json()).data;
  };

  const combined = await view(query);
  assert.equal(combined.total, 2);
  assert.deepEqual(combined.items.map(line => line.orderNumber), [salesOrder.number, salesOrder.number]);
  assert.notEqual(combined.items[0].salesUomCode, combined.items[1].salesUomCode);
  assert.equal((await view(new URLSearchParams({ ...Object.fromEntries(query), page: "2", pageSize: "1" }))).items[0].skuCode, secondCode);

  query.set("skuCode", sku.sku_code);
  const filtered = await view(query);
  assert.equal(filtered.total, 1);
  const [line] = filtered.items;
  assert.equal(line.skuName, unsafeName);
  assert.equal(line.quantity, "2.000000");
  assert.equal(line.lineAmount, "2.5000");
  assert.equal(line.currencyCode, f.currency);

  const csv = await request(`${report}/csv?${query}`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /attachment.*sales-report.*\.csv/u);
  const data = parse(await csv.text(), { bom: true, columns: true });
  assert.equal(data.length, 1);
  for (const key of ["orderNumber", "orderDate", "customerCode", "skuCode", "quantity", "lineAmount", "currencyCode"]) {
    assert.equal(data[0][key], line[key]);
  }
  assert.equal(data[0].skuName, "'" + unsafeName);
  assert.equal((await view(new URLSearchParams({ dateFrom: date, dateTo: date, customerCode: "not-this-customer", skuCode: sku.sku_code }))).total, 0);
  assert.equal((await view(new URLSearchParams({ dateFrom: dayOffset(-2), dateTo: dayOffset(-1), customerCode: customer.customer_code }))).total, 0);
  assert.equal((await request(`${report}?dateFrom=${dayOffset(1)}&dateTo=${date}`)).status, 400);
  assert.equal((await request(`${report}/csv?${query}`, { auth: false })).status, 401);

  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.view'", [f.roleId]);
  assert.equal((await request(`${report}?${query}`)).status, 403);
  assert.equal((await request(`${report}/csv?${query}`)).status, 403);
});
