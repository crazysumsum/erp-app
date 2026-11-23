// Run one selected step with the actual document from the preceding step.
const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const [step,...args]=process.argv.slice(2);
const actors={S01:'uat-sales',S02:'uat-sales',S03:'uat-warehouse',S04:'uat-warehouse',S05:'uat-warehouse',S06:'uat-warehouse',P01:'uat-buyer',P02:'uat-approver'};
assert(actors[step],'select S01 through S06, P01 or P02; use S03–S06 again for S07');
operate(actors[step],async({p,b,l,opt,dlg,u,creds})=>{
 const link=n=>p.getByRole('link',{name:n,exact:true});
 const clickDoc=async n=>{await b(n).or(link(n)).click()};
 const find=async(label,code)=>{await l(label).fill(code);await opt(new RegExp('^'+code+' —')).click()};
 const unit=async(label,code)=>{await l(label).click();await opt(new RegExp(code)).click()};
 const numeric=id=>{assert.match(id,/^[1-9]\d*$/);return id};
 if(step==='S01'){
   await p.goto('/sales/quotations');await link('新增報價').click();await find('客戶 *','UAT-CUS-NORTH');
   assert.equal(await l('貨幣 *').inputValue(),'HKD');
   // The default term is an acceptance point of the seed itself.
   await p.getByText('客戶預設條款',{exact:true}).waitFor();
   for(const [i,sku,code,qty,price] of [[1,'UAT-A1','BOX','2','100.00'],[2,'UAT-C1','EA','10','12.50']]){
      await find('搜尋 SKU',sku);await unit('銷售單位',code);await b('新增明細').click();
      await l('數量 '+i+' *').fill(qty);await l('售價 '+i+' *').fill(price);
   }
   await b('儲存報價 Draft').click();
   const banner=p.getByText(/報價 .+ 已儲存；總額 HKD 325\.0+/);await banner.waitFor();
   const number=(await banner.innerText()).match(/報價 (\S+) 已儲存/)[1];
   await p.goto('/sales/quotations');await l('報價編號／客戶').fill(number);await l('報價編號／客戶').press('Enter');await link('查看 '+number).click();
   await b('發出報價').click();await b('確認發出',dlg()).click();await p.getByText('已發出',{exact:true}).first().waitFor();
 }else if(step==='S02'){
   await p.goto('/sales/quotations/'+numeric(args[0]));await link('轉為銷售訂單').click();await find('履約倉庫 *','UAT-MAIN');
   await b('建立 Draft 銷售訂單').click();await link('查看銷售訂單').click();await b('確認訂單').click();
   await b('提交確認',dlg()).click();await p.getByText('已確認',{exact:true}).first().waitFor();
 }else if(step==='S03'){
   const [so,batch]=args;assert(so&&['1','2'].includes(batch));
   await p.goto('/fulfillment/queue');await l('SO 編號／客戶代碼').fill(so);await b('搜尋').click();
   await b('建立履約工作：'+so).click();await l('計劃數量：UAT-A1').fill('24');
   if(batch==='1')await l('計劃數量：UAT-C1').fill('10');
   else{const c=p.getByRole('checkbox',{name:'選取 UAT-C1'});if(await c.count())assert(!await c.isChecked());}
   await b('提交建立履約工作').click();const notice=p.getByText(/^已建立履約工作 /);await notice.waitFor();const number=(await notice.innerText()).split(' ').pop();await p.getByRole('main').getByRole('link',{name:'履約工作列表',exact:true}).click();await link('查看 '+number).click();await p.getByRole('heading',{name:new RegExp(number)}).first().waitFor();
 }else if(step==='S04'){
   await p.goto('/fulfillments/'+numeric(args[0]));await b('載入完整分配推薦').click();await b('更新候選並檢查全部選擇').click();
   await p.getByText('全部選擇已通過檢查，可確認提交',{exact:true}).waitFor();await b('提交分配庫存').click();await b('確認分配',dlg()).click();
   await p.getByText('揀貨中',{exact:true}).first().waitFor();await p.getByRole('tab',{name:'庫位／批次'}).click();
 }else if(step==='S05'){
   const [id,batch]=args;assert(['1','2'].includes(batch));await p.goto('/fulfillments/'+numeric(id));await b('載入完整揀貨明細').click();
   for(const [sku,qty] of batch==='1'?[['UAT-A1',24],['UAT-C1',10]]:[['UAT-A1',24]]){
      const inputs=p.getByRole('row').filter({hasText:sku}).getByRole('textbox',{name:/實揀數量/});
      await inputs.first().waitFor();
      let sum=0;for(const input of await inputs.all())sum+=Number(await input.inputValue());assert.equal(sum,qty);
   }
   await b('提交確認揀貨').click();await b('確認揀貨',dlg()).click();await p.getByText('已揀貨',{exact:true}).first().waitFor();
 }else if(step==='S06'){
   await p.goto('/fulfillments/'+numeric(args[0]));await l('送貨地址').click();await opt(/北碼頭收貨處|1 Test Pier Road/).click();
   await l('送貨聯絡人（選填）').click();await opt(/Tina Lau/).click();await l('包裹數（選填）').fill('1');
   await b('建立出貨草稿').click();await p.waitForURL(/\/shipments\/\d+$/);
   await b('載入完整出貨庫位摘要').click();await b('提交確認出貨').click();await b('確認全部出貨',dlg()).click();await p.getByText('已出貨',{exact:true}).first().waitFor();
   console.log('出貨',await p.locator('h1').innerText(),p.url());await link('送貨單列印').click();await p.waitForURL(/delivery-note\/print$/);await p.getByRole('row').filter({hasText:'UAT-A1'}).getByText('24 EA',{exact:true}).waitFor();
 }else if(step==='P01'){
   await p.goto('/purchasing/purchase-orders');await clickDoc('新增採購單');await find('供應商 *','UAT-SUP-B');
   await find('預設收貨倉庫（選填）','UAT-MAIN');
   for(const [i,sku,code,qty,price] of [[1,'UAT-B1','EA','5','35.00']]){
      await find('搜尋貨品',sku);await unit('採購單位',code);await b('新增明細').click();
      await l('數量 '+i+' *').fill(qty);await l('單價 '+i+' *').fill(price);
   }
   await b('儲存草稿').click();await p.waitForURL(/purchase-orders\/\d+\/edit$/);await b('提交').waitFor();console.log('Draft',p.url());
 }else if(step==='P02'){
   const [number]=args;assert(number);await p.goto('/purchasing/approvals');await clickDoc('處理 '+number);
   await p.getByRole('heading',{name:'審批快照'}).waitFor();await l('密碼 *').fill(creds['uat-approver']);await b('批准').click();
   await p.getByText('已確認',{exact:true}).first().waitFor();await p.reload();await p.getByText('已確認',{exact:true}).first().waitFor();
 }
 console.log(step,await p.locator('h1').innerText(),new URL(p.url()).pathname);
 await p.screenshot({path:u+'/evidence/'+step+'-'+Date.now()+'.png'});
});
