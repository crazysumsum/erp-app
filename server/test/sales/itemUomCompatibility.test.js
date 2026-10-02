import assert from "node:assert/strict";
import test from "node:test";
import { ItemAdminService } from "../../src/modules/item/ItemAdminService.js";

function fixture({ referenced = false, archiveReferenced = false, failAudit = false } = {}) {
  const calls = [], state = { version: 1, price: "100.0000", mappings: [
    { id: 91, sku_id: 10, uom_id: 5, to_base_factor: 1, is_base: 1, is_default_purchase: 1, is_default_sale: 1 },
    { id: 92, sku_id: 10, uom_id: 6, to_base_factor: 12, is_base: 0, is_default_purchase: 0, is_default_sale: 0 }
  ] };
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM users")) return [[{ username: "manager" }]];
      if (sql.includes("FROM roles")) return [[{ name: "manager" }]];
      if (sql.includes("FROM permissions")) return [[{ name: "item.mgmt" }]];
      if (sql.includes("information_schema.key_column_usage")) return [[{ tableName: "inventory_stock_controls", columnName: "sku_id" }]];
      if (sql.includes("information_schema.tables")) return [archiveReferenced ? [{ tableName: "sales_order_lines_archive" }] : []];
      if (sql.includes("FROM sales_order_lines_archive")) return [archiveReferenced ? [{ found: 1 }] : []];
      if (sql.includes("FROM `inventory_stock_controls`")) return [referenced ? [{ found: 1 }] : []];
      if (sql.includes("FROM item_skus")) return [[{ id: 10, item_id: 1, sku_code: "SKU-1", tracking_policy: "none", suggested_price_amount: state.price, version: state.version }]];
      if (sql.includes("FROM items")) return [[{ id: 1 }]];
      if (sql.includes("FROM item_sku_uoms")) return [state.mappings.map(row => ({ ...row }))];
      if (sql.includes("FROM item_sku_barcodes")) return [[]];
      if (sql.includes("FROM item_uoms")) return [params.map(id => ({ id }))];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE item_skus")) { state.price = params[8]; state.version += 1; }
      if (sql.includes("DELETE FROM item_sku_uoms")) {
        state.mappings = sql.includes("AND id") ? state.mappings.filter(row => row.id !== params[1]) : [];
      }
      if (sql.includes("UPDATE item_sku_uoms") && sql.includes("SET is_base = 0")) {
        for (const row of state.mappings) Object.assign(row, { is_base: 0, is_default_purchase: 0, is_default_sale: 0 });
      } else if (sql.includes("UPDATE item_sku_uoms")) {
        const row = state.mappings.find(row => row.id === params.at(-2));
        assert.ok(row, "retained mapping must still exist");
        Object.assign(row, { to_base_factor: params[0], is_base: params[1], is_default_purchase: params[2], is_default_sale: params[3] });
      }
      if (sql.includes("INSERT INTO item_sku_uoms")) {
        const id = 100 + state.mappings.length;
        state.mappings.push({ id, sku_id: params[0], uom_id: params[1], to_base_factor: params[2], is_base: params[3], is_default_purchase: params[4], is_default_sale: params[5] });
        return [{ insertId: id, affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    }
  };
  const database = { query: connection.query, async withTransaction(work, options) {
    calls.push({ options }); const before = structuredClone(state);
    try { return await work(connection); } catch (error) { Object.assign(state, before); throw error; }
  } };
  const service = new ItemAdminService({ database, logger: {}, time: { nowMs: () => 100 } });
  service.auditLog = { async record() { if (failAudit) throw new Error("audit failure"); } };
  service.getSku = async () => state;
  const command = { actorId: 1, claimedRoles: ["manager"], claimedPermissions: ["item.mgmt"], id: 10,
    skuName: "SKU One", trackingPolicy: "none", purchasable: true, sellable: true, inventoryTracked: true,
    suggestedPriceAmount: "150.0000", version: 1,
    uoms: [{ id: 91, uomId: 5, toBaseFactor: 1, isBase: true, isDefaultSale: true, isDefaultPurchase: true },
      { id: 92, uomId: 6, toBaseFactor: 12, isBase: false }], barcodes: [] };
  return { service, command, calls, state };
}

test("SKU price/name edits retain mapping IDs and follow the reviewed current-read lock graph", async () => {
  const { service, command, calls, state } = fixture({ referenced: true });
  await service.updateSku(command);
  assert.deepEqual(state.mappings.map(row => row.id), [91, 92]);
  assert.equal(state.price, "150.0000");
  assert.equal(calls[0].options.isolationLevel, "READ COMMITTED");
  const lockTables = calls.filter(call => /FOR (SHARE|UPDATE)/.test(call.sql ?? "")).map(call => call.sql.match(/FROM (\w+)/)[1]);
  assert.deepEqual(lockTables, ["item_uoms", "items", "item_skus", "item_sku_uoms"]);
});

test("SKU new associations insert, default slots clear before swaps and forged mapping IDs reject", async () => {
  const { service, command, calls, state } = fixture();
  command.uoms[0].isDefaultSale = false; command.uoms[0].isDefaultPurchase = false;
  command.uoms[1].isDefaultSale = true; command.uoms[1].isDefaultPurchase = true;
  command.uoms.push({ uomId: 7, toBaseFactor: 24, isBase: false }); command.reason = "Add packaging";
  await service.updateSku(command);
  assert.deepEqual(state.mappings.slice(0, 2).map(row => row.id), [91, 92]);
  assert.equal(state.mappings.find(row => row.uom_id === 7).to_base_factor, 24);
  const clear = calls.findIndex(call => call.sql?.includes("SET is_base = 0"));
  const assign = calls.findIndex(call => call.sql?.includes("SET to_base_factor"));
  assert.ok(clear >= 0 && clear < assign);
  const forged = fixture(); forged.command.uoms[0].id = 92;
  await assert.rejects(() => forged.service.updateSku(forged.command), { code: "SKU_CHILD_MISMATCH" });
});

test("SKU referenced conversion/tracking changes reject despite a reason; any later error rolls back retained IDs", async () => {
  for (const tracking of [false, true]) {
    const f = fixture({ referenced: true }); f.command.reason = "Change conversion";
    if (tracking) f.command.trackingPolicy = "batch"; else f.command.uoms[1].toBaseFactor = 13;
    await assert.rejects(() => f.service.updateSku(f.command), { code: tracking ? "TRACKING_POLICY_CHANGE_BLOCKED" : "UOM_CHANGE_BLOCKED" });
    assert.deepEqual(f.state.mappings.map(row => [row.id, row.to_base_factor]), [[91, 1], [92, 12]]);
    assert.equal(f.state.version, 1);
  }
  const f = fixture({ failAudit: true });
  await assert.rejects(() => f.service.updateSku(f.command), /audit failure/);
  assert.deepEqual(f.state.mappings.map(row => row.id), [91, 92]);
  assert.equal(f.state.version, 1);
});


test("SKU archived non-FK mapping references protect removal while ordinary price edits remain permitted", async () => {
  const f = fixture({ archiveReferenced: true });
  f.command.uoms = [f.command.uoms[0]]; f.command.reason = "Remove old packaging";
  await assert.rejects(() => f.service.updateSku(f.command), { code: "UOM_CHANGE_BLOCKED" });
  const probe = f.calls.find(call => call.sql?.includes("FROM sales_order_lines_archive"));
  assert.match(probe.sql, /sku_id = \? AND sku_uom_id IN \(\?\)/);
  assert.deepEqual(probe.params, [10, 92]);
  assert.deepEqual(f.state.mappings.map(row => row.id), [91, 92]);
  const price = fixture({ archiveReferenced: true });
  await price.service.updateSku(price.command);
  assert.equal(price.state.price, "150.0000");
});
