import process from "node:process";
import {randomUUID} from "node:crypto";
import {readdir} from "node:fs/promises";
import {test,expect} from "@playwright/test";
import {p1Fixture} from "../../../server/test/fulfillment/p1Fixture.js";
import {cancellationFacts} from "../../../server/test/fulfillment/p1CancellationFixture.js";
import {hashPassword} from "../../../server/src/modules/user/passwordHash.js";
import {createApplication} from "../../../server/src/framework/application/createApplication.js";
import {defaultConfigurationSource} from "../../../server/src/framework/configuration/applicationConfiguration.js";

// All data and the HTTP app share one UUID child schema. No mock API responses.
test.describe.serial("P1 real fulfillment operator and view-only flows",()=>{
 let f,app,id,viewer,password;const cleanup=[];
 test.beforeAll(async()=>{
  if(process.env.DB_INTEGRATION_TESTS!=="1"||!Number(process.env.FULFILLMENT_TEST_API_PORT))throw new Error("Explicit isolated P1 browser runtime required");
  f=await p1Fixture({after:fn=>cleanup.push(fn)});
  const directory=new URL("../../../server/database/migrations/",import.meta.url),installed=new Set([92,93,95,96,98]);
  for(const name of (await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
  password="Synthetic-"+randomUUID()+"-Aa1!";
  await f.db.execute("UPDATE users SET password_hash=? WHERE id=?",[await hashPassword(password),f.userId]);
  const name="view-"+randomUUID().slice(0,8),role=await f.s.insert("roles",{name,created_at:f.s.now});
  viewer=await f.s.insert("users",{username:name,password_hash:await hashPassword(password),display_name:"Synthetic P1 viewer",created_at:f.s.now,updated_at:f.s.now});
  await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[viewer,role]);
  await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='fulfillment.view'",[role]);
  const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"P1-SMOKE",normalized_code:"p1-smoke",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
  await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now});
  const source=defaultConfigurationSource(),connection=f.f.connectionOptions;
  app=await createApplication({configurationSource:{...source,application:{...source.application,host:"127.0.0.1",port:Number(process.env.FULFILLMENT_TEST_API_PORT)},security:{...source.security,cors:{...source.security.cors,allowedOrigins:`http://127.0.0.1:${process.env.FULFILLMENT_TEST_CLIENT_PORT}`}},database:{...source.database,host:connection.host,port:connection.port,socketPath:connection.socketPath,user:connection.user,password:connection.password,database:f.f.name},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,"sales.backorderAllocate":{enabled:false},"sales.importWorker":{enabled:false},"sales.quotationExpire":{enabled:false},"sales.confirmationRecovery":{enabled:false}}}}});
  cleanup.push(()=>app.shutdown("fulfillment_p1_browser_complete"));await app.start();
 });
 test.afterAll(async()=>{const errors=[];for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,"Owned P1 browser cleanup failed");});
 async function login(page,userId){
  const [[user]]=await f.db.query("SELECT username FROM users WHERE id=?",[userId]);
  const submit=async()=>{await page.goto("/login");await page.getByLabel("帳號").fill(user.username);await page.getByLabel("密碼",{exact:true}).fill(password);await page.getByRole("button",{name:"登入",exact:true}).click();};
  await submit();await expect(page).toHaveURL(/\/device\/pending/u);
  await f.db.execute("UPDATE user_devices SET status='approved',reviewed_at=?,review_note='Synthetic owned P1 browser approval' WHERE user_id=?",[Date.now(),userId]);
  await submit();await expect(page).toHaveURL(/\/$/u);
 }
 function observe(page){
  const errors=[],failed=[],responses=[],consoles=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("requestfailed",request=>failed.push(new URL(request.url()).pathname));
  page.on("response",response=>{if(response.status()>=400)responses.push({status:response.status(),path:new URL(response.url()).pathname});});
  page.on("console",message=>{if(["error","warning"].includes(message.type())&&!/403 \(Forbidden\)|net::ERR_FAILED/u.test(message.text()))consoles.push(message.text());});
  return {errors,failed,responses,consoles};
 }
 test("Queue Create Allocate original-event recovery Pick and current A4 print use real persisted work",async({page},info)=>{
  const observed=observe(page);await login(page,f.userId);
  await page.goto("/fulfillment/queue");await page.getByRole("button",{name:/^建立履約工作：/u}).click();
  const dialog=page.getByRole("dialog"),quantity=dialog.getByRole("textbox",{name:/^計劃數量：/u});
  await quantity.fill("0");await dialog.getByRole("button",{name:"提交建立履約工作",exact:true}).click();await expect(dialog.getByText("請輸入可履約範圍內的正整數",{exact:true})).toBeVisible();
  await quantity.fill("1");const created=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/v1/fulfillments/create");
  await dialog.getByRole("button",{name:"提交建立履約工作",exact:true}).click();const creation=await created;expect(creation.status()).toBe(201);id=(await creation.json()).data.outcome.id;await expect(dialog).not.toBeVisible();
  await page.goto(`/fulfillments/${id}`);await page.getByRole("button",{name:"載入完整分配推薦",exact:true}).click();await page.getByRole("button",{name:"更新候選並檢查全部選擇",exact:true}).click();await expect(page.getByText("全部選擇已通過檢查，可確認提交",{exact:true})).toBeVisible();
  const path=`/api/v1/fulfillments/${id}/allocate`;let original,committed;const dropped=Promise.withResolvers();
  await page.route("**"+path,async route=>{original=route.request().postDataJSON();const response=await route.fetch();expect(response.status()).toBe(200);expect((await f.db.query("SELECT version FROM fulfillments WHERE id=?",[id]))[0][0].version).toBe(2);const [operations]=await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=?",[original.eventId]);expect(operations).toHaveLength(1);expect(operations[0].status).toBe("SUCCEEDED");expect(String(operations[0].target_id)).toBe(String(id));const result=typeof operations[0].result_json==="string"?JSON.parse(operations[0].result_json):operations[0].result_json;expect(result.id).toBe(String(id));committed=await cancellationFacts(f);await route.abort("failed");dropped.resolve();});
  await page.getByRole("button",{name:"提交分配庫存",exact:true}).click();await page.getByRole("button",{name:"確認分配",exact:true}).click();await dropped.promise;await expect(page.getByRole("button",{name:"確認原分配操作結果",exact:true})).toBeVisible();await page.unroute("**"+path);
  await expect.poll(async()=>(await f.db.query("SELECT version FROM fulfillments WHERE id=?",[id]))[0][0].version).toBe(2);
  await page.reload();await expect(page.getByText("版本 2",{exact:true})).toBeVisible();let replay;
  page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname===path)replay=request.postDataJSON();});
  const recovered=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname===path);
  await page.getByRole("button",{name:"確認原分配操作結果",exact:true}).click();expect((await recovered).status()).toBe(200);expect(replay).toEqual(original);await expect(page.getByRole("button",{name:"確認原分配操作結果",exact:true})).toHaveCount(0);await expect(page.getByText("版本 2",{exact:true})).toBeVisible();
  expect(await cancellationFacts(f)).toEqual(committed);
  await page.getByRole("button",{name:"載入完整揀貨明細",exact:true}).click();await expect(page.getByRole("textbox",{name:/^實揀數量：分配/u})).toHaveValue("1");await page.getByRole("button",{name:"提交確認揀貨",exact:true}).click();await page.getByRole("button",{name:"確認揀貨",exact:true}).click();await expect(page.getByText("版本 3",{exact:true})).toBeVisible();
  expect(Number((await f.db.query("SELECT fulfilled_base_quantity FROM sales_order_lines WHERE id=?",[f.s.lineId]))[0][0].fulfilled_base_quantity)).toBe(0);expect(Number((await f.db.query("SELECT outstanding_quantity FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].outstanding_quantity)).toBe(1);expect(Number((await f.db.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE sku_id=?",[f.s.skuId]))[0][0].on_hand_quantity)).toBe(10);
  const printed=page.waitForResponse(response=>response.request().method()==="GET"&&new URL(response.url()).pathname===`/api/v1/fulfillments/${id}/pick-list`);
  await page.getByRole("link",{name:"揀貨單列印",exact:true}).click();expect((await printed).headers()["cache-control"].replaceAll(" ","")).toBe("private,no-store");await expect(page.getByRole("button",{name:"列印 A4",exact:true})).toBeVisible();await expect(page.getByRole("region",{name:"揀貨單預覽",exact:true}).getByText("狀態：已揀貨・版本 3",{exact:true})).toBeVisible();await expect(page.locator(".pick-list-allocations tbody tr")).toHaveCount(1);
  const pdf=await page.pdf({path:info.outputPath("p1-current-pick-list.pdf"),format:"A4",printBackground:true,preferCSSPageSize:true}),rawPdf=pdf.toString("latin1");expect(rawPdf.startsWith("%PDF-")).toBe(true);expect(pdf.length).toBeGreaterThan(1000);expect([...rawPdf.matchAll(/\/Type\s*\/Page\b/gu)]).toHaveLength(1);const box=rawPdf.match(/\/MediaBox\s*\[0 0 ([0-9.]+) ([0-9.]+)\]/u);expect(box).not.toBeNull();expect(Math.abs(Number(box[1])-595.28)).toBeLessThan(1);expect(Math.abs(Number(box[2])-841.89)).toBeLessThan(1);
  expect(observed.errors).toEqual([]);expect(observed.consoles).toEqual([]);expect(observed.failed).toEqual([path]);expect(observed.responses).toEqual([{status:403,path:"/api/v1/user/login"}]);
 });
 test("Fresh view-only principal reads current work and print with no operation controls",async({page})=>{
  const observed=observe(page);await login(page,viewer);await page.goto(`/fulfillments/${id}`);await expect(page.getByText("版本 3",{exact:true})).toBeVisible();
  for(const name of ["載入完整分配推薦","載入完整揀貨明細","提交取消履約工作"])await expect(page.getByRole("button",{name,exact:true})).toHaveCount(0);
  await page.goto("/fulfillment/queue");await expect(page.getByRole("button",{name:/^建立履約工作：/u})).toHaveCount(0);await page.goto(`/fulfillments/${id}/pick-list/print`);await expect(page.getByRole("region",{name:"揀貨單預覽",exact:true})).toContainText("狀態：已揀貨・版本 3");
  expect(observed.errors).toEqual([]);expect(observed.failed).toEqual([]);expect(observed.consoles).toEqual([]);expect(observed.responses).toEqual([{status:403,path:"/api/v1/user/login"}]);
 });
});
