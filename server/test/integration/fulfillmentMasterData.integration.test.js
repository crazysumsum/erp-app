import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { nativeDatabase } from "../fulfillment/nativeDatabase.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { CustomerLookupService } from "../../src/modules/customer/CustomerLookupService.js";

const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function fixture(t) {
  const f = await nativeDatabase(t, { migrateAuth:true });
  for (const name of ["0011_create_item_categories", "0012_create_item_brands", "0013_create_item_uoms", "0014_create_items",
    "0015_create_item_skus", "0016_create_item_sku_uoms", "0027_create_business_master", "0039_create_customer_equality_key_foundation",
    "0040_create_customer_classification_catalogs", "0041_extend_customer_root", "0044_create_customer_party_tables"]) {
    await (await import(`../../database/migrations/${name}.js`)).up(f.db);
  }
  const insert = async (sql, args=[]) => String((await f.db.execute(sql,args))[0].insertId);
  const category = await insert("INSERT INTO item_categories(name,created_at,updated_at) VALUES('Synthetic',1,1)");
  const brand = await insert("INSERT INTO item_brands(name,created_at,updated_at) VALUES('Synthetic',1,1)");
  const uom = await insert("INSERT INTO item_uoms(code,name,created_at,updated_at) VALUES('EA','Each',1,1)");
  const item = await insert("INSERT INTO items(name,category_id,brand_id,product_type,status,created_at,updated_at) VALUES('Synthetic',?,?,'variant','active',1,1)",[category,brand]);
  const ids = [];
  for (let i=0;i<100;i++) {
    const id = await insert("INSERT INTO item_skus(item_id,sku_code,sku_name,status,sellable,inventory_tracked,tracking_policy,created_at,updated_at) VALUES(?,?,'Synthetic','active',0,1,'none',1,1)",[item,`SYN-${i}`]);
    await insert("INSERT INTO item_sku_uoms(sku_id,uom_id,to_base_factor,is_base,created_at,updated_at) VALUES(?,?,1,1,1,1)",[id,uom]);
    ids.push(id);
  }
  const customers=[];
  for (const [code,status] of [["OWN","blocked"],["OTHER","active"]]) customers.push(Number(await insert("INSERT INTO customers(customer_code,customer_code_key,legal_name,legal_name_key,status,created_at,updated_at) VALUES(?,?,?,?,?,1,1)",[code,code,code,code,status])));
  const addressIds=[], contactIds=[];
  for (const [n,purpose,status,isDefault] of [[0,"shipping","active",0],[1,"shipping","active",1],[2,"billing","active",0],[3,"shipping","inactive",0]]) {
    const address=Number(await insert("INSERT INTO customer_addresses(customer_id,label,address_line1,status,notes,created_at,updated_at) VALUES(?,?,'Synthetic',?,'PRIVATE_SENTINEL',1,1)",[customers[0],`Address${n}`,status]));
    await insert("INSERT INTO customer_address_purposes(address_id,customer_id,purpose_code,is_default,created_at,updated_at) VALUES(?,?,?,?,1,1)",[address,customers[0],purpose,isDefault]);
    addressIds.push(address);
    const contact=Number(await insert("INSERT INTO customer_contacts(customer_id,name,status,notes,created_at,updated_at) VALUES(?,?,?,'PRIVATE_SENTINEL',1,1)",[customers[0],`Contact${n}`,status]));
    await insert("INSERT INTO customer_contact_purposes(contact_id,customer_id,purpose_code,is_default,created_at,updated_at) VALUES(?,?,?,?,1,1)",[contact,customers[0],purpose,isDefault]);
    contactIds.push(contact);
  }
  return {...f,ids,item,uom,customers,addressIds,contactIds,itemLookup:new ItemLookupService({database:f.db,logger:{error(){}},time:{nowMs:()=>100}}),customerLookup:new CustomerLookupService({database:f.db})};
}

nativeTest("P0 master-data native100-SKU batch locks one complete owner set and preserves versions/eligibility", async t => {
  const f=await fixture(t);
  let other;
  const failures=[];
  try {
  await f.db.beginTransaction();
  const profiles=await f.itemLookup.getFulfillmentInventoryProfilesInTransaction(f.db,[...f.ids].reverse());
  assert.equal(profiles.length,100);
  assert.deepEqual(profiles.map(p=>p.skuId),f.ids);
  assert.ok(profiles.every(p=>p.usable&&p.skuVersion===1&&p.itemVersion===1&&p.baseUom.version===1&&p.baseUom.uomId===f.uom));
  assert.doesNotMatch(JSON.stringify(profiles), /suggestedPrice|sellable|purchasable/);
  other=await mysql.createConnection({...f.options,database:f.name});
  await other.query("SET SESSION innodb_lock_wait_timeout=1");
  await assert.rejects(other.execute("UPDATE item_uoms SET version=version+1 WHERE id=?",[f.uom]),e=>e.code==="ER_LOCK_WAIT_TIMEOUT");
  await f.db.rollback();
  await other.execute("UPDATE item_uoms SET version=version+1 WHERE id=?",[f.uom]);
  await f.db.beginTransaction();
  const [fresh]=await f.itemLookup.getFulfillmentInventoryProfilesInTransaction(f.db,[f.ids[0]]);
  assert.equal(fresh.baseUom.version,2);
  } catch (error) { failures.push(error); }
  try { await f.db.rollback(); } catch (error) { failures.push(error); }
  try { if (other) await other.end(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures,"Master-data fixture or cleanup failed");
});

nativeTest("P0 master-data native Item changes reject missing Base UOM and preserve serial/nontracked/archive facts", async t => {
  const f=await fixture(t);
  for (const [sql,reason] of [
    ["UPDATE item_skus SET inventory_tracked=0 WHERE id=?","NOT_INVENTORY_TRACKED"],
    ["UPDATE item_skus SET status='archived' WHERE id=?","ARCHIVED"]
  ]) {
    await f.db.beginTransaction();
    await f.db.execute(sql,[f.ids[0]]);
    const [profile]=await f.itemLookup.getFulfillmentInventoryProfilesInTransaction(f.db,[f.ids[0]]);
    assert.equal(profile.usable,false); assert.ok(profile.reasons.includes(reason));
    await f.db.rollback();
  }
  await f.db.beginTransaction();
  await f.db.execute("UPDATE item_skus SET tracking_policy='serial' WHERE id=?",[f.ids[0]]);
  assert.equal((await f.itemLookup.getFulfillmentInventoryProfilesInTransaction(f.db,[f.ids[0]]))[0].trackingPolicy,"serial");
  await f.db.rollback();
  for (const sql of ["UPDATE item_uoms SET status='inactive' WHERE id=?", "DELETE FROM item_sku_uoms WHERE sku_id=?"]) {
    await f.db.beginTransaction();
    await f.db.execute(sql,[sql.includes("item_uoms SET")?f.uom:f.ids[0]]);
    await assert.rejects(f.itemLookup.getFulfillmentInventoryProfilesInTransaction(f.db,[f.ids[0]]), {code:"UOM_CONVERSION_INVALID"});
    await f.db.rollback();
  }
});

nativeTest("P0 master-data native Customer shipping lists and caller transaction assertions scope owner/purpose/status/version", async t => {
  const f=await fixture(t), lookup=f.customerLookup, customer=f.customers[0];
  const addresses=await lookup.listAddresses(customer,{purpose:"shipping"}),contacts=await lookup.listContacts(customer,{purpose:"shipping"});
  assert.deepEqual(addresses.map(x=>x.addressId),[f.addressIds[1],f.addressIds[0]]);
  assert.deepEqual(contacts.map(x=>x.contactId),[f.contactIds[1],f.contactIds[0]]);
  assert.doesNotMatch(JSON.stringify({addresses,contacts}),/PRIVATE_SENTINEL|bank|notes/);
  for (const [method,id,table,purposes,key] of [
    ["assertAddressUsableInTransaction",f.addressIds[0],"customer_addresses","customer_address_purposes","address_id"],
    ["assertContactUsableInTransaction",f.contactIds[0],"customer_contacts","customer_contact_purposes","contact_id"]
  ]) {
    await f.db.beginTransaction();
    const result=await lookup[method](f.db,customer,id,{purpose:"shipping",expectedVersion:1});
    assert.equal(result.customerStatus,"blocked","existing-order provider retains current Customer lifecycle facts");
    await f.db.rollback();
    for (const mutation of [
      ()=>f.db.execute(`UPDATE ${table} SET version=2 WHERE id=?`,[id]),
      ()=>f.db.execute(`UPDATE ${table} SET status='inactive' WHERE id=?`,[id]),
      ()=>f.db.execute(`DELETE FROM ${purposes} WHERE ${key}=? AND purpose_code='shipping'`,[id])
    ]) {
      await f.db.beginTransaction(); await mutation();
      await assert.rejects(lookup[method](f.db,customer,id,{purpose:"shipping",expectedVersion:1}),e=>["VERSION_CONFLICT","CUSTOMER_PARTY_NOT_FOUND"].includes(e.code));
      await f.db.rollback();
    }
    await f.db.beginTransaction();
    await assert.rejects(lookup[method](f.db,f.customers[1],id,{purpose:"shipping",expectedVersion:1}),{code:"CUSTOMER_PARTY_NOT_FOUND"});
    await f.db.rollback();
    await assert.rejects(lookup[method](null,customer,id,{purpose:"shipping",expectedVersion:1}),TypeError);
  }
});
