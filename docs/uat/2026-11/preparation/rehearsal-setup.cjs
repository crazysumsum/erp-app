const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const [mode,sku,quantity]=process.argv.slice(2);
operate(mode==='approvals'?'uat-approver':'uat-inventory',async({p,b,l,opt,u,name,creds})=>{
 const shot=label=>p.screenshot({path:u+'/evidence/'+label+'.png'});
 if(mode==='warehouses'){
 const loaded=p.waitForResponse(r=>r.url().includes('warehouses')&&r.url().includes('/api/')&&r.request().method()==='GET');await p.goto('/inventory/warehouses');await loaded;await b('新增倉庫').waitFor();
 for(const [wh,title,bins] of [['UAT-MAIN','UAT 主倉',[['UAT-PICK','主倉揀貨位'],['UAT-HOLD','主倉隔離位']]],['UAT-SECOND','UAT 副倉',[['UAT-PICK','副倉揀貨位']]]]){
 const select=b('查看倉庫 '+wh+' 的庫位');
 if(!await select.count()){await b('新增倉庫').click();await l('倉庫代碼').fill(wh);await l('倉庫名稱').fill(title);await b('儲存').click();}await select.click();await p.getByRole('heading',{name:new RegExp('^'+wh+' —')}).waitFor();await p.locator('.bin-panel .q-table__progress').waitFor({state:'hidden'});
 for(const [code,n] of bins){const read=b('查看庫位 '+code+' 詳情');if(!await read.isVisible({timeout:1000}) && !await read.waitFor({timeout:1200}).then(()=>true,()=>false)){await b('新增庫位').click();await l('庫位代碼').fill(code);await l('庫位名稱').fill(n);await b('儲存').click();}await read.waitFor();}
 await p.reload();await select.click();await p.getByRole('heading',{name:new RegExp('^'+wh+' —')}).waitFor();await p.locator('.bin-panel .q-table__progress').waitFor({state:'hidden'});for(const [code] of bins)await b('查看庫位 '+code+' 詳情').waitFor();await shot('warehouses-'+wh);console.log(wh,bins.map(x=>x[0]));}
 }else if(mode==='stock'){
 assert.equal(quantity,{'UAT-A1':'48','UAT-C1':'10'}[sku]);await p.goto('/inventory/adjustments?action=IN');await l('SKU Code').fill(sku);await b('查找 SKU').click();await p.getByText(new RegExp('^'+sku+' ')).first().waitFor().catch(()=>{});
 for(const [label,code] of [['倉庫','UAT-MAIN'],['庫位','UAT-REHEARSAL']]){await l(label).click();await opt(code).click();}await l('數量（Base UOM）').fill(quantity);await l('原因說明').fill('UAT 預演專用臨時庫存 '+sku);await b('準備確認').click();
 await l('目前密碼（必填）').fill(creds[name]);await b('確認過帳').click();const done=p.getByRole('heading',{name:/已確認過帳/});await done.waitFor();await p.getByRole('link',{name:/查看已過帳 Movement/}).first().waitFor();console.log(sku,await done.innerText(),await p.getByRole('link',{name:/查看已過帳 Movement/}).first().innerText());await shot('rehearsal-stock-'+sku);
 }else if(mode==='approvals'){
 await p.goto('/purchasing/settings');const sw=p.getByRole('switch',{name:'提交採購單時需要審批'});await sw.waitFor();if(!(await sw.isChecked())){await sw.click();await l('變更原因 *').fill('UAT 預演採購單由獨立主管審批');await l('密碼 *').fill(creds[name]);const saved=p.waitForResponse(r=>r.url().includes('purchasing')&&['POST','PUT','PATCH'].includes(r.request().method()));await b('儲存設定').click();assert((await saved).ok());}await p.reload();await sw.waitFor();assert(await sw.isChecked());await shot('purchasing-approval-setting');console.log('approval enabled');
 }else throw Error('unknown step');
});
