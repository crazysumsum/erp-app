// Run one stage against a designated rehearsal and retain the actual document IDs for the next stage.
const {operate} = require('./operator.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [stage, warehouse] = process.argv.slice(2);
const actors = {stock:'uat-inventory',stockLate:'uat-inventory', quote:'uat-sales', order:'uat-sales', fulfill:'uat-warehouse', allocate:'uat-warehouse', pick:'uat-warehouse', ship:'uat-warehouse'};
assert(actors[stage] && ['UAT-MAIN','UAT-SECOND'].includes(warehouse));
const secondary = warehouse === 'UAT-SECOND';
const quantity = 2;
const lot = secondary ? 'UAT-B1-SECOND-1124' : 'UAT-B1-EARLY';
const expiry = secondary ? '2027-04-15' : '2027-01-15';
operate(actors[stage], async ({p,b,l,opt,dlg,u,creds}) => {
 const dir = path.join(u,'evidence','two-warehouse');
 fs.mkdirSync(dir,{recursive:true});
 const file = path.join(dir,warehouse+'.json');
 const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {warehouse, bin:'UAT-PICK', sku:'UAT-B1', lot, expiry, quantity};
 assert(!state[stage+'Done'],'Step already recorded. Inspect original document before retrying.');
 const save = () => {fs.writeFileSync(file+'.tmp', JSON.stringify(state,null,2)+'\n');fs.renameSync(file+'.tmp',file);};
 const link = name => p.getByRole('link',{name,exact:true});
 const find = async (label,code) => {await l(label).fill(code);await opt(new RegExp('^'+code+' —')).click();};
 const id = () => {const match=new URL(p.url()).pathname.match(/\/(\d+)(?:\/edit)?$/);assert(match);return Number(match[1]);};
 const shot = () => p.screenshot({path:path.join(dir,warehouse+'-'+stage+'.png')});
 if(stage==='stock'||stage==='stockLate'){
   state.quantity=quantity;const fixtureLot=stage==='stockLate'?'UAT-B1-SECOND-LATE':lot;const fixtureExpiry=stage==='stockLate'?'2027-06-15':expiry;
   assert(secondary);await p.goto('/inventory/opening');
   const csv='warehouseCode,binCode,skuCode,lotNumber,expiryDate,stockStatus,baseQuantity\n'+[warehouse,'UAT-PICK','UAT-B1',fixtureLot,fixtureExpiry,'AVAILABLE',10].join(',')+'\n';
   await l('CSV 檔案（必填）').setInputFiles({name:'uat-secondary-lot.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
   await b('上傳預檢').click();await l('入帳原因（必填）').fill('UAT 兩倉批次出貨，副倉合成批次 10 EA');await b('核對並確認').click();await l('目前密碼（必填）').fill(creds['uat-inventory']);
   const posted=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/confirm'));await b('確認過帳',dlg()).click();const response=await posted;assert(response.ok());await p.getByText(/已完成入帳 · 1 筆/).waitFor();
 }else if(stage==='quote'){
   await p.goto('/sales/quotations');await link('新增報價').click();await find('客戶 *','UAT-CUS-NORTH');await find('搜尋 SKU','UAT-B1');await l('銷售單位').click();await opt(/EA/).click();await b('新增明細').click();
   await l('數量 1 *').fill(String(quantity));await l('售價 1 *').fill('35.00');await b('儲存報價 Draft').click();
   const banner=p.getByText(/報價 .+ 已儲存/);await banner.waitFor();state.quote=(await banner.innerText()).match(/報價 (\S+) 已儲存/)[1];save();
   await p.goto('/sales/quotations');await l('報價編號／客戶').fill(state.quote);await l('報價編號／客戶').press('Enter');await link('查看 '+state.quote).click();await b('發出報價').click();await b('確認發出',dlg()).click();await p.getByText('已發出',{exact:true}).first().waitFor();state.quoteId=id();
 }else if(stage==='order'){
   await p.goto('/sales/quotations/'+state.quoteId);await link('轉為銷售訂單').click();await find('履約倉庫 *',warehouse);await b('建立 Draft 銷售訂單').click();await link('查看銷售訂單').click();await b('確認訂單').click();await b('提交確認',dlg()).click();await p.getByText('已確認',{exact:true}).first().waitFor();state.order=(await p.locator('h1').innerText()).match(/SO-\d+-\d+/)[0];state.orderId=id();
 }else if(stage==='fulfill'){
   await p.goto('/fulfillment/queue');await l('SO 編號／客戶代碼').fill(state.order);await b('搜尋').click();await b('建立履約工作：'+state.order).click();await l('計劃數量：UAT-B1').fill(String(quantity));await b('提交建立履約工作').click();const created=p.getByText(/^已建立履約工作 /);await created.waitFor();state.fulfillment=(await created.innerText()).split(' ').pop();await p.getByRole('main').getByRole('link',{name:'履約工作列表',exact:true}).click();await link('查看 '+state.fulfillment).click();state.fulfillmentId=id();
 }else if(stage==='allocate'){
   await p.goto('/fulfillments/'+state.fulfillmentId);await b('載入完整分配推薦').click();await b('更新候選並檢查全部選擇').click();const candidate=p.getByRole('row').filter({hasText:lot}).filter({hasText:expiry});await candidate.getByRole('textbox',{name:/分配數量/}).waitFor();assert.equal(Number(await candidate.getByRole('textbox',{name:/分配數量/}).inputValue()),quantity);const lateLot=secondary?'UAT-B1-SECOND-LATE':'UAT-B1-LATE';const late=p.getByRole('row').filter({hasText:lateLot});assert.equal(Number(await late.getByRole('textbox',{name:/分配數量/}).inputValue()),0);await p.getByText('全部選擇已通過檢查，可確認提交',{exact:true}).waitFor();await b('提交分配庫存').click();await b('確認分配',dlg()).click();await p.getByText('揀貨中',{exact:true}).first().waitFor();
 }else if(stage==='pick'){
   await p.goto('/fulfillments/'+state.fulfillmentId);await b('載入完整揀貨明細').click();const row=p.getByRole('row').filter({hasText:lot}).filter({hasText:'UAT-PICK'});assert((await row.innerText()).includes(expiry));const qty=row.getByRole('textbox',{name:/實揀數量/});assert.equal(Number(await qty.inputValue()),quantity);await b('提交確認揀貨').click();await b('確認揀貨',dlg()).click();await p.getByText('已揀貨',{exact:true}).first().waitFor();
 }else if(stage==='ship'){
   await p.goto('/fulfillments/'+state.fulfillmentId);await l('送貨地址').click();await opt(/北碼頭收貨處|1 Test Pier Road/).click();await l('包裹數（選填）').fill('1');await b('建立出貨草稿').click();await p.waitForURL(/\/shipments\/\d+$/);state.shipId=id();save();
   await b('載入完整出貨庫位摘要').click();const row=p.getByRole('row').filter({hasText:lot}).filter({hasText:'UAT-PICK'}).filter({hasText:expiry});await row.getByText(quantity+' EA',{exact:true}).waitFor();await shot();
   await b('提交確認出貨').click();await b('確認全部出貨',dlg()).click();await p.getByText('已出貨',{exact:true}).first().waitFor();await p.reload();await p.getByText('已出貨',{exact:true}).first().waitFor();state.shipment=(await p.locator('h1').innerText()).match(/SHP-\d+-\d+/)[0];await link('送貨單列印').click();await p.getByRole('row').filter({hasText:'UAT-B1'}).getByText(quantity+' EA',{exact:true}).waitFor();
 }
 state[stage+'Done']=true;save();if(stage!=='ship')await shot();console.log(stage,warehouse,'PASS',state.shipment||state.order||state.quote||'');
});
