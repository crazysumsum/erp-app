const u=require('node:path').resolve(__dirname, '..'), fs=require('node:fs'), assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const [stage,batch,arg]=process.argv.slice(2), first=batch==='1', code=first?'P03':'P05', lot=first?'SMOKE-L1':'SMOKE-L2', qty=first?'60':'40';
const smoke=JSON.parse(fs.readFileSync(u+'/evidence/final-smoke-context.json','utf8'));
assert(/^[1-9][0-9]*$/.test(String(smoke.poId))&&/^PO-[0-9]{6}-[0-9]{6}$/.test(smoke.poNumber)&&typeof smoke.a1Before==='number'&&typeof smoke.b2Before==='number');
const ledger=()=>execFileSync('/usr/local/mysql/bin/mysql',['--defaults-file='+u+'/private/mysql-app.cnf','--protocol=TCP','-h127.0.0.1','-P3406','erp_uat_rehearse_20261123','-BN','-e',"SELECT COUNT(*) FROM inventory_movements; SELECT s.sku_code,COALESCE(SUM(v.on_hand_quantity),0) FROM item_skus s LEFT JOIN inventory_stock_balances v ON v.sku_id=s.id WHERE s.sku_code IN ('UAT-A1','UAT-B2') GROUP BY s.sku_code ORDER BY s.sku_code"],{encoding:'utf8'}).trim();
require(u+'/preparation/operator.cjs').operate('uat-warehouse',async({p,b,l,opt,dlg})=>{
 const save=(file,obj)=>fs.writeFileSync(u+'/evidence/final-smoke-'+file+'.json',JSON.stringify(obj,null,2),{flag:'wx'});
 const shot=file=>p.screenshot({path:u+'/evidence/final-smoke-'+file+'.png'});
 const res=path=>p.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST');
 if(stage==='new'){
  await p.goto('/purchasing/purchase-orders/'+smoke.poId);await p.getByTestId('po-receipts').getByRole('link',{name:'建立收貨單'}).click();await require(u+'/app/node_modules/@playwright/test').expect(l('採購單 *')).toHaveValue(new RegExp(smoke.poNumber));
  const req=res('/api/v1/goods-receipts/create');await b('建立收貨單').click();const r=await req;assert.equal(r.status(),201);const {id,number}= (await r.json()).data;await p.waitForURL('**/goods-receipts/'+id+'/edit');save(code+'-draft',{id,number});console.log('draft',id,number);return;
 }
 const {id,number}=JSON.parse(fs.readFileSync(u+'/evidence/final-smoke-'+code+'-draft.json'));
 const base='/purchasing/goods-receipts/'+id;
 if(stage==='post'){
  await p.goto(base+'/edit');
  for(const [i,sku,n] of [[0,'UAT-A1','1'],[1,'UAT-B2',qty]]){
   await l('加入採購單行').click();await opt(new RegExp(sku)).click();const line=p.getByTestId('receipt-line-'+i);
   assert.match(await line.innerText(),i?/EA/:/BOX/);await l('數量 *',line).fill(n);
   await l('倉庫 *',line).click();await opt(/^UAT-MAIN/).click();await l('庫位 *',line).click();await opt('UAT-PICK').click();
   if(i)await l('到期日 *',line).fill('2027-11-23');
  }
  const line=p.getByTestId('receipt-line-1'), binLot=l('批號 *',line), units=l('數量 *',line);
  async function post(){await b('確認收貨並入庫').click();const wait=res('/api/v1/goods-receipts/'+id+'/confirm');await b('確認入庫',dlg()).click();return await wait;}
  if(!first){await binLot.fill(lot);await units.fill('45');}
  const before=ledger();const rejected=await post();const e=(await rejected.json()).error;console.log('declined',rejected.status(),e?.code);assert.equal(rejected.status(),409);assert.equal(e.code,first?'LOT_REQUIRED':'OVER_RECEIPT_REASON_REQUIRED');assert.equal(ledger(),before);
  await shot(code+'-rejected');if(first)await binLot.fill(lot);else await units.fill(qty);
  const result=await post(),body=await result.json();console.log('confirm',result.status(),body.error?.code);assert.equal(result.status(),200);await p.waitForURL('**'+base);await p.reload();await p.getByText('已確認',{exact:true}).first().waitFor();
  const mov=p.getByText(/^庫存異動 #\d+$/);await mov.first().waitFor();const moves=await mov.allTextContents();assert.equal(moves.length,2);const after=ledger();
  save(code+'-confirmed',{id,number,lot,qty,before,after,rejected:e.code,moves});await shot(code+'-confirmed');console.log({number,moves,before,after});return;
 }
 if(stage==='check'){
  const rec=JSON.parse(fs.readFileSync(u+'/evidence/final-smoke-'+code+'-confirmed.json'));const movementIds=rec.moves.map(s=>s.match(/\d+/)[0]);
  await p.goto('/purchasing/purchase-orders/'+smoke.poId);const hist=p.getByTestId('po-receipts');
  await hist.getByRole('link',{name:new RegExp(number)}).waitFor();await hist.getByText(first?/收貨：.*部分收貨/:/收貨：.*全部收貨|收貨：.*已收貨/).first().waitFor();const history=await hist.innerText();await shot(code+'-po');
  for(const [i,sku,skuId,total,amount] of [[0,'UAT-A1',1,smoke.a1Before+(first?24:48),24],[1,'UAT-B2',4,smoke.b2Before+(first?60:100),Number(qty)]]){
   await p.goto('/inventory/stocks?q='+sku+'&skuId='+skuId);const summary=p.locator('[aria-label="SKU 數量摘要"]');await summary.getByText('總 On Hand').first().waitFor();assert.match(await summary.innerText(),new RegExp('總 On Hand\\s*'+total+'\\b'));
   if(i)await p.getByRole('row').filter({hasText:lot}).filter({hasText:'UAT-PICK'}).first().waitFor();await shot(code+'-'+sku+'-stocks');
   await p.goto('/inventory/movements?skuId='+skuId+'&movementId='+movementIds[i]);await p.getByRole('heading',{name:'Movement '+movementIds[i]+' 詳情'}).waitFor();await p.getByRole('row').filter({has:p.getByRole('button',{name:'查看 Movement '+movementIds[i],exact:true})}).filter({hasText:sku}).getByText('入 '+amount,{exact:true}).waitFor();await shot(code+'-'+sku+'-movement');
  }
  await p.goto('/inventory/lots?skuId=4');const lotRow=p.getByRole('row').filter({hasText:lot});await lotRow.filter({hasText:'2027-11-23'}).first().waitFor();await shot(code+'-lots');save(code+'-verified',{history,movementIds,lot,qty,ledger:ledger()});console.log('verified',code);
 }
});
