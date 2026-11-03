// Exact approved75B two browser journeys. Native synthetic schemas; no capacity or mocked API success.
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import process from 'node:process';
import {readdir} from 'node:fs/promises';
import {shipmentDraftFixture,shipmentTwoLineFixture} from '../../../server/test/fulfillment/p1CancellationFixture.js';
import {hashPassword} from '../../../server/src/modules/user/passwordHash.js';
import {createApplication} from '../../../server/src/framework/application/createApplication.js';
import {defaultConfigurationSource} from '../../../server/src/framework/configuration/applicationConfiguration.js';
import {createMySqlDatabasePool} from '../../../server/src/services/mysqldatabase/connection.js';

async function setup(twoLines=false,serviceOptions={}){
 const cleanup=[],t={after:fn=>cleanup.push(fn)};let app;
 try{
  const f=twoLines?await shipmentTwoLineFixture(t):await shipmentDraftFixture(t),draft=twoLines?f.draft:await f.create({...f.body(),notes:'Retained synthetic browser input'});
  const directory=new URL('../../../server/database/migrations/',import.meta.url),installed=new Set([92,93,95,96,98,...(twoLines?[97]:[])]);
  for(const name of(await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
  const password='Synthetic-'+randomUUID()+'-Aa1!';await f.db.execute('UPDATE users SET password_hash=? WHERE id=?',[await hashPassword(password),f.userId]);
  const source=defaultConfigurationSource(),connection=f.f.connectionOptions;
  app=await createApplication({serviceOptions,configurationSource:{...source,application:{...source.application,host:'127.0.0.1',port:Number(process.env.FULFILLMENT_TEST_API_PORT)},security:{...source.security,cors:{...source.security.cors,allowedOrigins:`http://127.0.0.1:${process.env.FULFILLMENT_TEST_CLIENT_PORT}`}},database:{...source.database,host:connection.host,port:connection.port,socketPath:connection.socketPath,user:connection.user,password:connection.password,database:f.f.name},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,'sales.backorderAllocate':{enabled:false},'sales.importWorker':{enabled:false},'sales.quotationExpire':{enabled:false},'sales.confirmationRecovery':{enabled:false},'fulfillment.confirmationRecovery':{enabled:false}}}}});
  cleanup.push(()=>app.shutdown('private_p2_browser_complete'));await app.start();
  const [[user]]=await f.db.query('SELECT username FROM users WHERE id=?',[f.userId]);
  async function login(page){const submit=async()=>{await page.goto('/login');await page.getByLabel('帳號').fill(user.username);await page.getByLabel('密碼',{exact:true}).fill(password);await page.getByRole('button',{name:'登入',exact:true}).click();};await submit();await expect(page).toHaveURL(/\/device\/pending/u);await f.db.execute("UPDATE user_devices SET status='approved',reviewed_at=?,review_note='Synthetic owned P2 browser approval' WHERE user_id=?",[Date.now(),f.userId]);await submit();await expect(page).toHaveURL(/\/$/u);}
  return {f,draft,login,close:async()=>{const errors=[];for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Owned browser cleanup failed');}};
 }catch(error){const errors=[error];for(const close of cleanup.reverse())try{await close();}catch(cleanupError){errors.push(cleanupError);}throw errors.length===1?error:new AggregateError(errors,'Browser setup and owned cleanup failed');}
}
function observe(page){const observed={errors:[],console:[],failed:[],responses:[],commands:[]};page.on('pageerror',error=>observed.errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))observed.console.push(message.text());});page.on('requestfailed',request=>observed.failed.push(new URL(request.url()).pathname));page.on('response',response=>{if(response.status()>=400)observed.responses.push({status:response.status(),path:new URL(response.url()).pathname});});page.on('request',request=>{if(request.method()==='POST'&&/\/shipments\/[^/]+\/confirm$/u.test(new URL(request.url()).pathname))observed.commands.push(request.postDataJSON());});return observed;}
function safeBrowser(observed,{failed=[],responses=[]}={}){expect(observed.errors).toEqual([]);expect(observed.failed).toEqual(failed);expect(observed.responses).toEqual([{status:403,path:'/api/v1/user/login'},...responses]);expect(observed.console.filter(value=>!/Failed to load resource:.*(?:403|409)|net::ERR_FAILED/u.test(value))).toEqual([]);}

test('BROWSER-SHIPMENT-HAPPY native two-line Draft cancel/recreate, Confirm and two A4 snapshot views at four widths',async({page},info)=>{
 const runtime=await setup(true),{f,draft}=runtime,observed=observe(page);
 try{
  await runtime.login(page);await page.goto(`/shipments/${draft.outcome.id}`);await expect(page.getByText('版本 1',{exact:true})).toBeVisible();
  await page.getByLabel('出貨取消原因（選填）').fill('Replace the synthetic shipping draft');await page.getByRole('button',{name:'取消出貨草稿',exact:true}).click();await page.getByRole('button',{name:'確認取消出貨草稿',exact:true}).click();await expect(page.getByText('已取消',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'查看來源履約單',exact:true}).click();await expect(page.getByRole('button',{name:'建立出貨草稿',exact:true})).toBeEnabled();
  await page.getByLabel('物流商（選填）').fill('Synthetic browser carrier');await page.getByLabel('總重量（選填）').fill('1.1234567');await page.getByRole('button',{name:'建立出貨草稿',exact:true}).click();await expect(page.getByText('請輸入有效正數，最多14位整數及6位小數',{exact:true})).toBeVisible();
  await page.getByLabel('總重量（選填）').fill('1.25');await page.getByLabel('重量單位').click();await page.getByRole('option',{name:'KG',exact:true}).click();
  const created=page.waitForResponse(response=>response.request().method()==='POST'&&/\/fulfillments\/[^/]+\/shipments\/create$/u.test(new URL(response.url()).pathname));await page.getByRole('button',{name:'建立出貨草稿',exact:true}).click();const createResponse=await created;expect(createResponse.status()).toBe(201);const id=(await createResponse.json()).data.outcome.id;await expect(page).toHaveURL(new RegExp(`/shipments/${id}$`));
  for(const width of [375,768,1024,1440]){await page.setViewportSize({width,height:900});await expect(page.getByRole('region',{name:'出貨單內容',exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`shipment-${width}.png`)});}
  await page.getByRole('button',{name:'載入完整出貨庫位摘要',exact:true}).click();await expect(page.getByText('完整摘要共 2 筆庫位／批次，2 行。表格可分頁核對。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'提交確認出貨',exact:true}).focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'確認全部出貨',exact:true}).click();await expect(page.getByText('已出貨',{exact:true})).toBeVisible();expect(observed.commands).toHaveLength(1);
  await expect(page.getByRole('button',{name:'保存出貨草稿',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'提交確認出貨',exact:true})).toHaveCount(0);
  for(const [label,title,packing]of [['送貨單列印','送貨單',false],['裝箱單列印','裝箱單',true]]){
   const response=page.waitForResponse(value=>new URL(value.url()).pathname===`/api/v1/shipments/${id}/delivery-note`);await page.getByRole('link',{name:label,exact:true}).click();expect((await response).headers()['cache-control'].replaceAll(' ','')).toBe('private,no-store');await expect(page.getByRole('region',{name:`${title}預覽`,exact:true})).toContainText('Synthetic browser carrier');await expect(page.locator('.shipment-document-lines tbody tr')).toHaveCount(2);if(packing)await expect(page.locator('.shipment-document-rows tbody tr')).toHaveCount(2);
   const pdf=await page.pdf({path:info.outputPath(packing?'packing.pdf':'delivery.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});expect(pdf.toString('latin1').startsWith('%PDF-')).toBe(true);expect(pdf.length).toBeGreaterThan(1000);await page.getByRole('link',{name:'返回出貨單',exact:true}).click();
  }
  await page.reload();await expect(page.getByText('已出貨',{exact:true})).toBeVisible();const [issues]=await f.db.query('SELECT id FROM shipment_issue_details WHERE shipment_id=?',[id]);expect(issues).toHaveLength(2);safeBrowser(observed);
 }finally{await runtime.close();}
});

test('BROWSER-SHIPMENT-RECOVERY native stale source, revoked access and original-event unknown result never resubmit',async({browser})=>{
 for(const scenario of ['stale','revoked','unknown']){
  let eventId=null,releaseGate=()=>{},phaseBCount=0;const gate=new Promise(resolve=>{releaseGate=resolve;}),installed=new WeakSet();
  const poolFactory=config=>{const pool=createMySqlDatabasePool(config),get=pool.getConnection.bind(pool);pool.getConnection=async()=>{const connection=await get();if(installed.has(connection))return connection;installed.add(connection);const query=connection.query.bind(connection);connection.query=async(sql,values)=>{const result=await query(sql,values),text=typeof sql==='string'?sql:sql.sql;if(eventId&&text==='SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE'&&values?.[0]===eventId){phaseBCount++;if(phaseBCount===1)await gate;}return result;};return connection;};return pool;};
  let runtime,context;
  try{
   runtime=await setup(false,scenario==='unknown'?{mysqldatabase:{poolFactory}}:{});context=await browser.newContext({baseURL:`http://127.0.0.1:${process.env.FULFILLMENT_TEST_CLIENT_PORT}`});const page=await context.newPage(),{f,draft}=runtime,observed=observe(page),path=`/api/v1/shipments/${draft.outcome.id}/confirm`;
   await runtime.login(page);await page.goto(`/shipments/${draft.outcome.id}`);await page.getByRole('button',{name:'載入完整出貨庫位摘要',exact:true}).click();await page.getByLabel('出貨備註（選填）').fill('Unsaved synthetic browser input');await expect(page.getByRole('button',{name:'提交確認出貨',exact:true})).toBeDisabled();await page.getByLabel('出貨備註（選填）').fill('Retained synthetic browser input');await expect(page.getByRole('button',{name:'提交確認出貨',exact:true})).toBeEnabled();
   if(scenario==='stale')await f.db.execute('UPDATE customer_addresses SET version=version+1,updated_at=? WHERE id=?',[Date.now(),f.s.addressId]);
   if(scenario==='revoked')await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.name='fulfillment.operation' AND rp.role_id IN (SELECT role_id FROM user_roles WHERE user_id=?)",[f.userId]);
   if(scenario==='unknown')await page.route('**'+path,async route=>{eventId=route.request().postDataJSON().eventId;const response=await route.fetch();expect(response.status()).toBe(202);await route.abort('failed');});
   await page.getByRole('button',{name:'提交確認出貨',exact:true}).click();const result=scenario==='unknown'?null:page.waitForResponse(response=>new URL(response.url()).pathname===path);await page.getByRole('button',{name:'確認全部出貨',exact:true}).click();
   if(scenario==='unknown'){
    await expect.poll(()=>phaseBCount).toBe(1);await expect(page.getByText('正查詢同一確認結果；不會重新提交',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存出貨草稿',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'取消出貨草稿',exact:true})).toBeDisabled();await page.reload();await expect(page.getByText('正查詢同一確認結果；不會重新提交',{exact:true})).toBeVisible();releaseGate();await expect(page.getByText('已出貨',{exact:true})).toBeVisible();expect(phaseBCount).toBe(1);expect(observed.commands).toHaveLength(1);expect(observed.commands[0].eventId).toBe(eventId);await page.goto('/shipments');await expect(page.getByRole('region',{name:'出貨單列表內容',exact:true})).toBeVisible();safeBrowser(observed,{failed:[path]});
   }else{
    const response=await result;expect(response?.status()).toBe(scenario==='stale'?409:403);await expect(page.getByLabel('出貨備註（選填）')).toHaveValue('Retained synthetic browser input');await expect(page.getByRole('alert').first()).toBeVisible();expect(observed.commands).toHaveLength(1);const [[row]]=await f.db.query('SELECT status FROM shipments WHERE id=?',[draft.outcome.id]);expect(row.status).toBe('DRAFT');expect((await f.db.query('SELECT id FROM shipment_issue_details WHERE shipment_id=?',[draft.outcome.id]))[0]).toHaveLength(0);safeBrowser(observed,{responses:[{status:scenario==='stale'?409:403,path}]});
   }
  }finally{releaseGate();try{await context?.close();}finally{await runtime?.close();}}
 }
});
