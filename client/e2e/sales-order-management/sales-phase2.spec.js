import process from "node:process";
import { test,expect } from "@playwright/test";
import { createServer } from "vite";
import { randomUUID,randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrationFixture } from "../../../server/test/sales/phase1/fixtures.js";
import { createApplication } from "../../../server/src/framework/application/createApplication.js";
import { defaultConfigurationSource } from "../../../server/src/framework/configuration/applicationConfiguration.js";
import { SalesOrderConfirmationService } from "../../../server/src/modules/sales/SalesOrderConfirmationService.js";
import { formatDateForFile } from "../../../server/src/services/time/timeFormat.js";
let app,vite,f,origin,operatorToken,viewerToken,operatorId,operatorRole,operatorClaims,customerCode,skuCode,warehouseCode;
const callbacks=[];
test.beforeAll(async()=>{
 if(process.env.DB_INTEGRATION_TESTS!=="1"||!/^erp_sales_phase2_/u.test(process.env.DB_NAME??""))throw new Error("Sales browser tests require the approved isolated synthetic Phase2 database");
 f=await migrationFixture({after(fn){callbacks.push(fn);}},[]);
 const source=defaultConfigurationSource(),port=randomInt(32000,59000);origin=`http://127.0.0.1:${port}`;
 app=await createApplication({configurationSource:{...source,application:{...source.application,port:0},sales:{...source.sales,manualConfirmationWaitMs:100},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.confirmationRecovery":{enabled:false},"sales.backorderAllocate":{enabled:false}}},security:{...source.security,cors:{...source.security.cors,allowedOrigins:origin}}}});
 async function actor(permissions){const role=`sales-e2e-${randomUUID().slice(0,8)}`,roleId=await f.insert("roles",{name:role,created_at:f.now}),userId=await f.insert("users",{username:role,password_hash:"synthetic-only",display_name:"Synthetic Sales browser",created_at:f.now,updated_at:f.now});
  await f.db.execute("INSERT INTO user_roles (user_id,role_id) VALUES (?,?)",[userId,roleId]);for(const permission of permissions)await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?",[roleId,permission]);
  f.beforeParents.push(async()=>{await f.db.execute("DELETE FROM sales_audit_logs WHERE actor_user_id=?",[userId]);await f.db.execute("DELETE FROM sales_operation_requests WHERE actor_user_id=?",[userId]);await f.db.execute("DELETE FROM fr_token_versions WHERE subject=?",[String(userId)]);await f.db.execute("DELETE FROM user_roles WHERE user_id=?",[userId]);await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[roleId]);});
  if(permissions.includes("sales.mgmt")){operatorId=userId;operatorRole=roleId;operatorClaims={actorId:userId,claimedRoles:[role],claimedPermissions:permissions};}
  return app.services.require("jwt").issue({roles:[role],permissions},{subject:String(userId),version:await app.services.require("tokenRevocation").currentVersion(String(userId)),authTime:Math.floor(f.now/1000)});
 }
 operatorToken=await actor(["sales.view","sales.mgmt"]);viewerToken=await actor(["sales.view"]);
 f.beforeParents.push(async()=>{await f.db.execute("DELETE FROM sales_quotation_conversions WHERE quotation_id IN (SELECT id FROM sales_quotations WHERE customer_id=?)",[f.customerId]);await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?",[f.customerId]);await f.db.execute("DELETE FROM sales_quotations WHERE customer_id=?",[f.customerId]);});
 await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?",[f.currency]);await f.db.execute("UPDATE item_skus SET sellable=1,suggested_price_amount='3.3333' WHERE id=?",[f.skuId]);
 customerCode=(await f.db.query("SELECT customer_code FROM customers WHERE id=?",[f.customerId]))[0][0].customer_code;skuCode=(await f.db.query("SELECT sku_code FROM item_skus WHERE id=?",[f.skuId]))[0][0].sku_code;warehouseCode=(await f.db.query("SELECT warehouse_code FROM inventory_warehouses WHERE id=?",[f.warehouseId]))[0][0].warehouse_code;
 await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?",[f.skuId]);
 const bin=await f.insert("inventory_bins",{warehouse_id:f.warehouseId,bin_code:"browser",normalized_code:"browser",created_at:f.now,updated_at:f.now});
 await f.db.execute("INSERT INTO inventory_stock_balances (warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,created_at,updated_at) VALUES (?,?,?,'AVAILABLE',100,?,?)",[f.warehouseId,bin,f.skuId,f.now,f.now]);
 f.beforeParents.push(async()=>{await f.db.execute("DELETE FROM sales_orders WHERE customer_id=?",[f.customerId]);await f.db.execute("DELETE FROM inventory_reservations WHERE warehouse_id=?",[f.warehouseId]);await f.db.execute("DELETE FROM inventory_stock_balances WHERE warehouse_id=?",[f.warehouseId]);await f.db.execute("DELETE FROM inventory_stock_controls WHERE warehouse_id=?",[f.warehouseId]);});
 const {url}=await app.start();process.env.VITE_API_BASE_URL=url;
 vite=await createServer({root:fileURLToPath(new URL("../..",import.meta.url)),configFile:fileURLToPath(new URL("../../vite.config.js",import.meta.url)),server:{host:"127.0.0.1",port,strictPort:true}});await vite.listen();
});
test.afterAll(async()=>{try{if(vite)await vite.close();if(app)await app.shutdown("sales_phase2_browser_complete");}finally{for(const callback of callbacks.reverse())await callback();}});
function monitor(page,expected=[]){const errors=[],network=[];let offline=false;
 page.on("pageerror",error=>errors.push(error.message));page.on("console",message=>{if(message.text().startsWith("[Vue warn]")||(message.type()==="error"&&!message.text().includes("Failed to load resource")&&!message.text().includes("net::ERR_INTERNET_DISCONNECTED")))errors.push(message.text());});
 page.on("requestfailed",request=>{const error=request.failure()?.errorText;if(!offline&&error!=="net::ERR_ABORTED")network.push(error);});
 page.on("response",response=>{if(response.status()>=400&&!expected.some(([status,path])=>response.status()===status&&new URL(response.url()).pathname.startsWith(path)))network.push(response.status());});
 return {offline(value){offline=value;},verify(){expect(errors).toEqual([]);expect(network).toEqual([]);}};
}
async function authenticate(page,token=operatorToken){await page.goto(origin+"/login");await page.evaluate(async value=>{const {setToken}=await import("/src/framework/auth/tokenStorage.js");setToken(value,900,3600);},token);}
async function command(page,method,...args){return page.evaluate(async({method,args})=>{const {default:sales}=await import("/src/services/sales.js");return sales[method](...args);},{method,args});}
function orderInput(quantity="2.000000",price="3.3333"){return {eventId:randomUUID(),customerId:f.customerId,currencyCode:f.currency,fulfillmentWarehouseId:f.warehouseId,orderDate:formatDateForFile(new Date(f.now),"Asia/Hong_Kong"),lines:[{skuId:f.skuId,skuUomId:f.skuUomId,quantity,unitSellingPrice:price}]};}
async function seedOrder(page,quantity,price){await page.goto(origin+"/sales/orders");return (await command(page,"createOrder",orderInput(quantity,price))).salesOrder;}
async function openConfirm(page,id){await page.goto(origin+`/sales/orders/${id}`);await page.getByRole("button",{name:"確認訂單",exact:true}).click();await expect(page.getByRole("button",{name:"提交確認",exact:true})).toBeEnabled();}
async function stock(available){await f.db.execute("UPDATE inventory_stock_balances b LEFT JOIN inventory_stock_controls c ON c.warehouse_id=b.warehouse_id AND c.sku_id=b.sku_id SET b.on_hand_quantity=b.allocated_quantity+COALESCE(c.reserved_quantity,0)+? WHERE b.warehouse_id=?",[available,f.warehouseId]);}
async function assertCommit(id,expected){const [[row]]=await f.db.query("SELECT status FROM sales_orders WHERE id=?",[id]);expect(row.status).toBe(expected);}
test.beforeEach(async()=>{await stock(100);});

test("TC-022 real confirmation200 keeps zero price and exact Inventory commitment",async({page})=>{
 const check=monitor(page);await authenticate(page);const order=await seedOrder(page,undefined,"0.0000");await openConfirm(page,order.id);
 await expect(page.getByRole("dialog")).toContainText(customerCode);await expect(page.getByRole("dialog")).toContainText(warehouseCode);await expect(page.getByRole("dialog")).toContainText("零售價");
 await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toBeVisible();await expect(page.getByRole("button",{name:"確認訂單",exact:true})).toHaveCount(0);await expect(page.getByText("Reserved 2",{exact:true})).toBeVisible();await assertCommit(order.id,"CONFIRMED");
 const [[row]]=await f.db.query("SELECT COUNT(*) AS n FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id WHERE l.sales_order_id=?",[order.id]);expect(Number(row.n)).toBe(1);check.verify();
});
test("TC-021 real partial ATP reports Backorder without negative stock",async({page})=>{
 const check=monitor(page);await authenticate(page);const order=await seedOrder(page,"10.000000");await stock(3);await openConfirm(page,order.id);await page.getByRole("button",{name:"提交確認",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toContainText("Backorder");await expect(page.getByText("Reserved 3",{exact:true})).toBeVisible();await expect(page.getByText("Backorder 7",{exact:true})).toBeVisible();await assertCommit(order.id,"CONFIRMED");check.verify();
});
test("TC-022 true held Warehouse makes202; refresh preserves the UUID and polls committed terminal",async({page})=>{
 const check=monitor(page);let posts=0;page.on("request",request=>{if(new URL(request.url()).pathname.endsWith("/confirm"))posts++;});await authenticate(page);const order=await seedOrder(page);await openConfirm(page,order.id);
 await f.db.query("START TRANSACTION");await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[f.warehouseId]);let saved;
 try{
  const response=page.waitForResponse(value=>new URL(value.url()).pathname.endsWith("/confirm"));await page.getByRole("button",{name:"提交確認",exact:true}).click();const accepted=await response;expect(accepted.status()).toBe(202);expect(accepted.headers()["retry-after"]).toBe("2");
  await expect(page.getByRole("status").filter({hasText:"確認結果仍在處理"})).toBeVisible();saved=await page.evaluate(id=>sessionStorage.getItem(`sales.confirm:${id.actor}:${id.order}`),{actor:operatorId,order:order.id});expect(saved).not.toBeNull();
  await page.reload();await expect(page.getByRole("status").filter({hasText:"確認結果仍在處理"})).toBeVisible();expect(await page.evaluate(id=>sessionStorage.getItem(`sales.confirm:${id.actor}:${id.order}`),{actor:operatorId,order:order.id})).toBe(saved);expect(posts).toBe(1);await expect(page.getByRole("button",{name:"確認訂單",exact:true})).toHaveCount(0);
 }finally{await f.db.query("ROLLBACK");}
 await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toBeVisible();expect(posts).toBe(1);await assertCommit(order.id,"CONFIRMED");check.verify();
});
test("TC-022 offline uncertain submission retries one original UUID after fresh404 lookup",async({page,context})=>{
 const check=monitor(page,[[404,"/api/v1/sales-operations/"]]);await authenticate(page);const order=await seedOrder(page);await openConfirm(page,order.id);check.offline(true);await context.setOffline(true);await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"未確定"})).toBeVisible();
 const saved=await page.evaluate(id=>sessionStorage.getItem(`sales.confirm:${id.actor}:${id.order}`),{actor:operatorId,order:order.id});await context.setOffline(false);check.offline(false);await expect(page.getByRole("button",{name:"重查原操作並重試",exact:true})).toBeVisible();await page.getByRole("button",{name:"重查原操作並重試",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toBeVisible();
 const [[row]]=await f.db.query("SELECT confirmation_event_id FROM sales_orders WHERE id=?",[order.id]);expect(row.confirmation_event_id).toBe(JSON.parse(saved).eventId);check.verify();
});
test("TC-024 actual credit ON_HOLD is shown before submission",async({page})=>{
 const check=monitor(page);await authenticate(page);const order=await seedOrder(page);
 try{await f.db.execute("INSERT INTO customer_credit_profiles (customer_id,credit_status,last_change_reason,created_at,updated_at) VALUES (?,'on_hold','synthetic browser',?,?)",[f.customerId,f.now,f.now]);await page.goto(origin+`/sales/orders/${order.id}`);await page.getByRole("button",{name:"確認訂單",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"ON_HOLD"})).toBeVisible();await expect(page.getByRole("button",{name:"提交確認",exact:true})).toBeDisabled();await assertCommit(order.id,"DRAFT");}
 finally{await f.db.execute("DELETE FROM customer_credit_profiles WHERE customer_id=?",[f.customerId]);}check.verify();
});
test("TC-024 changed current master warning freezes the actual latest snapshot",async({page})=>{
 const check=monitor(page);await authenticate(page);const order=await seedOrder(page);
 try{await f.db.execute("UPDATE item_skus SET sku_name='Current Synthetic SKU' WHERE id=?",[f.skuId]);await openConfirm(page,order.id);await expect(page.getByRole("dialog")).toContainText("主檔參考與 Draft 快照不同");await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toContainText("主檔已變更");await expect(page.getByRole("cell",{name:`${skuCode} — Current Synthetic SKU`,exact:true})).toBeVisible();}
 finally{await f.db.execute("UPDATE item_skus SET sku_name=? WHERE id=?",[order.lines[0].skuName,f.skuId]);}check.verify();
});
test("TC-022 real permission revocation rejects confirm and retains unknown intent without polling effects",async({page})=>{
 const check=monitor(page,[[403,"/api/v1/sales-orders/"]]);await authenticate(page);const order=await seedOrder(page);await openConfirm(page,order.id);
 try{await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='sales.mgmt'",[operatorRole]);await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await expect(page.getByRole("button",{name:"確認訂單",exact:true})).toHaveCount(0);await assertCommit(order.id,"DRAFT");}
 finally{await f.db.execute("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE name='sales.mgmt'",[operatorRole]);}check.verify();
});
test("TC-022 Viewer, responsive keyboard dialog and navigation preserve unresolved event",async({page})=>{
 const check=monitor(page);await authenticate(page);const order=await seedOrder(page);await authenticate(page,viewerToken);await page.goto(origin+`/sales/orders/${order.id}`);await expect(page.getByRole("button",{name:"確認訂單",exact:true})).toHaveCount(0);
 await authenticate(page);await openConfirm(page,order.id);await page.setViewportSize({width:320,height:812});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole("button",{name:"返回",exact:true}).focus();await page.keyboard.press("Tab");await expect(page.getByRole("button",{name:"提交確認",exact:true})).toBeFocused();await page.screenshot({path:`${process.env.HARNESS_RUN_DIR}/confirmation-dialog-320.png`,animations:"disabled"});await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toBeHidden();
 await page.setViewportSize({width:1024,height:812});await page.getByRole("button",{name:"確認訂單",exact:true}).click();await expect(page.getByRole("button",{name:"提交確認",exact:true})).toBeEnabled();
 await f.db.query("START TRANSACTION");await f.db.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[f.warehouseId]);
 try{await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"確認結果仍在處理"})).toBeVisible();await page.getByRole("link",{name:"返回訂單列表",exact:true}).click();await expect(page).toHaveURL(/\/sales\/orders(?:\?.*)?$/u);expect(await page.evaluate(id=>sessionStorage.getItem(`sales.confirm:${id.actor}:${id.order}`),{actor:operatorId,order:order.id})).not.toBeNull();}
 finally{await f.db.query("ROLLBACK");}
 await page.goto(origin+`/sales/orders/${order.id}`);await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toBeVisible();check.verify();
});


test("TC-022 actual uncommitted Phase A preserves the saved UUID despite visible Draft and lookup404",async({page})=>{
 const check=monitor(page,[[404,"/api/v1/sales-operations/"]]);await authenticate(page);const order=await seedOrder(page),eventId=randomUUID(),input={eventId,version:order.version};
 await page.evaluate(value=>sessionStorage.setItem(`sales.confirm:${value.actor}:${value.id}`,JSON.stringify(value.input)),{actor:operatorId,id:order.id,input});
 const service=new SalesOrderConfirmationService({database:app.services.require("mysqldatabase"),time:app.services.require("time"),logger:app.services.require("logging").logger});
 let entered;const claimed=new Promise(resolve=>{entered=resolve;}),realClaim=service.operations.claimConfirmation.bind(service.operations);
 service.operations.claimConfirmation=async(...args)=>{const intent=await realClaim(...args);entered();return intent;};
 await f.db.query("START TRANSACTION");await f.db.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[order.id]);
 const phaseA=service.startConfirmation({claims:operatorClaims,id:order.id,input});let intent;
 try{
  await claimed;await page.goto(origin+`/sales/orders/${order.id}`);await expect(page.getByRole("button",{name:"重查原操作並重試",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"放棄原操作並重載 Draft",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"確認訂單",exact:true})).toHaveCount(0);
  expect(await page.evaluate(value=>JSON.parse(sessionStorage.getItem(`sales.confirm:${value.actor}:${value.id}`)),{actor:operatorId,id:order.id})).toEqual(input);
 }finally{await f.db.query("ROLLBACK");intent=await phaseA;}
 await service.completeConfirmation({eventId,claims:operatorClaims,leaseOwner:intent.leaseOwner});await page.getByRole("button",{name:"重查原操作並重試",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toBeVisible();await assertCommit(order.id,"CONFIRMED");check.verify();
});
test("TC-022 actual rejected stale version reloads before a new successful intent",async({page})=>{
 const check=monitor(page,[[409,"/api/v1/sales-orders/"]]);await authenticate(page);const order=await seedOrder(page);await openConfirm(page,order.id);
 const editable=orderInput();await command(page,"updateOrder",order.id,{...editable,version:order.version,lines:editable.lines.map((line,index)=>({...line,id:order.lines[index].id}))});
 await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:"確認未完成：VERSION_CONFLICT"})).toBeVisible();
 expect(await page.evaluate(value=>sessionStorage.getItem(`sales.confirm:${value.actor}:${value.id}`),{actor:operatorId,id:order.id})).toBeNull();
 await page.getByRole("button",{name:"確認訂單",exact:true}).click();await expect(page.getByRole("button",{name:"提交確認",exact:true})).toBeEnabled();await page.getByRole("button",{name:"提交確認",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"訂單已確認"})).toBeVisible();await assertCommit(order.id,"CONFIRMED");check.verify();
});
