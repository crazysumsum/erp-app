const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const [task,actor,ref,amount]=process.argv.slice(2);
operate(actor,async({p,b,l,opt,dlg,u,creds})=>{
 const link=n=>p.getByRole('link',{name:n,exact:true});
 const find=async(label,code)=>{await l(label).fill(code);await opt(new RegExp('^'+code+' —')).click()};
 const wait=n=>p.getByText(n,{exact:true}).first().waitFor(), proof=n=>p.screenshot({path:u+'/evidence/'+n+'.png',fullPage:true});
 const createLine=async()=>{await find('搜尋 SKU','UAT-C1');await l('銷售單位').click();await opt(/^EA —/).click();await b('新增明細').click();await l('數量 1 *').fill(amount||'5');await l('售價 1 *').fill('12.50');};
 if(task==='createSO'||task==='createQT'){
 const quote=task==='createQT';await p.goto(quote?'/sales/quotations/new':'/sales/orders/new');await find('客戶 *','UAT-CUS-NORTH');if(!quote)await find('履約倉庫 *','UAT-MAIN');await createLine();await l('備註').fill(ref);
 await b(quote?'儲存報價 Draft':'儲存 Draft 銷售訂單').click();
 if(quote)await p.getByText(/報價 .+ 已儲存/).waitFor();else await p.waitForURL(/orders\/\d+$/);
 }else if(task==='confirmSO'){
 await p.goto('/sales/orders/'+ref);await b('確認訂單').click();await b('提交確認',dlg()).click();await wait('已確認');
 }else if(task==='claim'){
 await p.goto('/fulfillment/queue');await l('SO 編號／客戶代碼').fill(ref);await b('搜尋').click();await b('建立履約工作：'+ref).click();
 assert.equal(await l('計劃數量：UAT-C1').inputValue(),amount);await b('提交建立履約工作').click();const notice=p.getByText(/^已建立履約工作 /);await notice.waitFor();console.log(await notice.innerText());
 }else if(task==='pick'){
 await p.goto('/fulfillments/'+ref);await b('載入完整揀貨明細').click();const input=p.getByRole('row').filter({hasText:'UAT-C1'}).getByRole('textbox',{name:/實揀數量/});const original=Number(await input.inputValue());assert(original>=Number(amount));await input.fill(amount);
 if(original>Number(amount)){await b('提交確認揀貨').click();await p.getByText(/原因/).filter({hasText:/至少|必須|5 至|5–500|5至500/}).first().waitFor().catch(()=>{});assert(!await dlg().count());await l('短揀原因：UAT-C1').fill('UAT 預演實物當次短揀兩件');}
 await b('提交確認揀貨').click();await b('確認揀貨',dlg()).click();await wait('已揀貨');
 }else if(task==='ship'){
 await p.goto('/fulfillments/'+ref);await l('送貨地址').click();await opt(/北碼頭收貨處/).click();await b('建立出貨草稿').click();await p.waitForURL(/shipments\/\d+$/);await b('載入完整出貨庫位摘要').click();await b('提交確認出貨').click();await b('確認全部出貨',dlg()).click();await wait('已出貨');await link('送貨單列印').click();await p.getByRole('row').filter({hasText:'UAT-C1'}).getByText(amount+' EA',{exact:true}).waitFor();
 }else if(task==='editSO'||task==='editQT'){
 const quote=task==='editQT';const route='/sales/'+(quote?'quotations':'orders')+'/'+ref;const notes='UAT 例外：已修改的草稿備註';await p.goto(route);await link('編輯 Draft').click();await l('備註').fill(notes);await l('數量 1 *').fill('2');
 const updates=[];const endpoint='/api/v1/sales-orders/'+ref+'/update';
 if(!quote){p.on('request',r=>{if(new URL(r.url()).pathname===endpoint&&r.method()==='POST')updates.push(r.headers()['idempotency-key']);});
 await p.route(r=>r.pathname===endpoint,async route=>{const saved=await route.fetch();assert(saved.ok());await route.abort('connectionreset');},{times:1});}
 await b(quote?'儲存報價 Draft':'儲存 Draft 銷售訂單').click();
 if(!quote){await b('重試確認結果').waitFor();await proof('limit-15-original-operation');await b('重試確認結果').click();}
 await p.getByText(/已儲存；已重新讀取最新版本/).waitFor();if(!quote){assert(updates[0]&&updates.length===2&&updates[0]===updates[1]);}
 await p.goto(route);await wait(notes);await p.getByText(/25\.00/).first().waitFor();await proof(task+'-updated-'+ref);
 }else if(task==='cancelQT'||task==='cancelSO'){
 const quote=task==='cancelQT';await p.goto('/sales/'+(quote?'quotations':'orders')+'/'+ref);await b(quote?'取消報價':'取消訂單').click();await l(quote?'取消原因 *':'操作原因（5–500 字元）').fill('UAT 獨立例外單據取消');await b(quote?'確認取消':'提交訂單操作',dlg()).click();await wait('已取消');await p.reload();await wait('已取消');
 }else if(task==='withdraw'){
 await p.goto('/purchasing/purchase-orders/'+ref);await b('撤回審批').click();await dlg().getByRole('textbox').fill('UAT 採購撤回重新核對數量');await b('撤回',dlg()).click();await link('編輯草稿').waitFor();await p.reload();await link('編輯草稿').waitFor();assert(!await b('撤回審批').count());
 }else if(task==='block'||task==='unblock'||task==='resume'){
 await p.goto('/suppliers');await link('查看 UAT-SUP-B 詳情').click();await p.getByRole('heading',{name:/UAT-SUP-B|UAT 封鎖測試/}).first().waitFor();const action={block:'封鎖',unblock:'解除封鎖',resume:'重新啟用'}[task];
 await b(action).click();await l('原因 *').fill('UAT 預演採購供應商狀態例外');await l('目前密碼 *').fill(creds[actor]);await b('確認'+action,dlg()).click();await dlg().waitFor({state:'hidden'});await p.reload();await wait({block:'已封鎖',unblock:'已暫停',resume:'啟用'}[task]);
 }else if(task==='blockedPO'){
 await p.goto('/purchasing/purchase-orders/new');await find('供應商 *','UAT-SUP-A');await l('供應商 *').fill('UAT-SUP-B');await p.getByText(/沒有符合|無符合|找不到/).first().waitFor();assert.equal(await opt(/^UAT-SUP-B/).count(),0);
 }else throw Error(task);
 console.log(task,p.url(),(await p.locator('.q-page').last().innerText()).slice(0,620));await proof(task+'-'+(ref||'result'));
});
