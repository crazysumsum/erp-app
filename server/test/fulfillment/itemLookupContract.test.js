import assert from "node:assert/strict";
import test from "node:test";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
const NOW_MS = 100;
function fakeDatabase(sets) {
  const calls=[];
  return { calls, async query(sql,params) { calls.push({sql,params}); return [sets[calls.length-1]??[]]; } };
}
function createService({database}) { return {service:new ItemLookupService({database,logger:{error(){}},time:{nowMs:()=>NOW_MS}})}; }
function skuRow(overrides={}) { return {id:10,item_id:1,sku_code:"SYN",sku_name:"Synthetic",sku_status:"active",sku_version:1,
  item_name:"Synthetic",item_status:"active",product_type:"variant",inventory_tracked:1,sellable:0,purchasable:0,tracking_policy:"none",
  effective_from:null,effective_to:null,shelf_life_days:null,min_receipt_life_days:null,min_sale_life_days:null,...overrides}; }
function uomRow(overrides={}) { return {id:91,sku_id:10,uom_id:5,uom_code:"EA",to_base_factor:1,is_base:1,...overrides}; }
function inventoryTransaction(sku=skuRow(),uom=uomRow()) { return fakeDatabase([
  [{sku_id:sku.id,item_id:sku.item_id,id:uom.id,uom_id:uom.uom_id}],
  [{id:uom.uom_id,code:uom.uom_code,status:"active",version:1}],
  [{id:sku.item_id,name:sku.item_name,status:sku.item_status,product_type:sku.product_type,version:1}],
  [sku],[uom]
]); }

test("Fulfillment inventory batch locks the complete sorted set once and preserves inventory eligibility", async () => {
  const sku = skuRow({ sellable: 0, suggested_price_amount: null, sku_version: 3 });
  const tx = inventoryTransaction(sku);
  const { service } = createService({ database: fakeDatabase([]) });
  const [profile] = await service.getFulfillmentInventoryProfilesInTransaction(tx, ["10", "10"], { atMs: NOW_MS });
  assert.equal(tx.calls.length, 5);
  assert.deepEqual(tx.calls[0].params, [10]);
  assert.equal(profile.skuId, "10");
  assert.equal(profile.itemId, String(sku.item_id));
  assert.equal(profile.skuVersion, 3);
  assert.equal(profile.itemVersion, 1);
  assert.deepEqual(profile.baseUom, { uomId: "5", uomCode: "EA", version: 1 });
  assert.equal(profile.usable, true, "existing inventory work does not require a new-sale price or sellable flag");
  assert.equal(Object.hasOwn(profile, "suggestedPrice"), false);
  assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.baseUom) && Object.isFrozen(profile.reasons));
  for (const status of ["inactive", "archived"]) {
    const [blocked] = await service.getFulfillmentInventoryProfilesInTransaction(inventoryTransaction(skuRow({ sku_status: status, sku_version: 1 })), ["10"]);
    assert.equal(blocked.usable, false);
  }
});

test("Fulfillment inventory batch fails closed for missing/moved identities, inactive or non-base UOM and invalid wire", async () => {
  const { service } = createService({ database: fakeDatabase([]) });
  for (const ids of [[1], ["01"], ["0"], ["9007199254740992"], Array.from({length:101}, (_, i) => String(i+1)), null]) {
    await assert.rejects(() => service.getFulfillmentInventoryProfilesInTransaction(inventoryTransaction(), ids), TypeError);
  }
  await assert.rejects(() => service.getFulfillmentInventoryProfilesInTransaction(null, ["10"]), TypeError);
  await assert.rejects(() => service.getFulfillmentInventoryProfilesInTransaction(inventoryTransaction(), ["10"], { atMs: -1 }), TypeError);
  assert.deepEqual(await service.getFulfillmentInventoryProfilesInTransaction(fakeDatabase([]), []), []);
  await assert.rejects(() => service.getFulfillmentInventoryProfilesInTransaction(fakeDatabase([[]]), ["10"]), { code: "SKU_NOT_FOUND" });
  for (const uom of [uomRow({is_base:0}), uomRow({to_base_factor:2})]) {
    await assert.rejects(() => service.getFulfillmentInventoryProfilesInTransaction(inventoryTransaction(skuRow(), uom), ["10"]), {code:"UOM_CONVERSION_INVALID"});
  }
  for (const tx of [inventoryTransaction(skuRow({item_id:"9007199254740992"})), inventoryTransaction(skuRow(),uomRow({uom_id:"9007199254740992"}))]) {
    await assert.rejects(() => service.getFulfillmentInventoryProfilesInTransaction(tx,["10"]),TypeError);
  }
});
