const u=require('node:path').resolve(__dirname, '..');
const fs=require('node:fs'), assert=require('node:assert/strict');
const [stage,id,number]=process.argv.slice(2);assert(['submit','receive','cancel','close-remaining'].includes(stage));assert(/^\d+$/.test(id));assert(/^PO-202611-00000[45]$/.test(number));
require(u+'/preparation/operator.cjs').operate(stage==='receive'?'uat-warehouse':'uat-buyer',async({p,b,l,opt,dlg})=>{
 const path='/api/v1/purchase-orders/'+id,fetchOrder=p.waitForResponse(r=>new URL(r.url()).pathname===path&&r.ok());
 await p.goto('/purchasing/purchase-orders/'+id+(stage==='submit'?'/edit':''));const result=await fetchOrder,data=(await result.json()).data;assert.equal(data.number,number);
 if(stage==='submit'){
   assert.equal(data.status,'DRAFT');await b('提交').click();await l('審批人 *').click();await opt('採購主管').click();await b('提交審批').click();await p.getByText('待審批',{exact:true}).first().waitFor();return;
 }
 if(stage==='receive'){
   assert.equal(data.status,'CONFIRMED');await p.getByTestId('po-receipts').getByRole('link',{name:'建立收貨單'}).click();await require(u+'/app/node_modules/@playwright/test').expect(l('採購單 *')).toHaveValue(new RegExp(number));
   await b('建立收貨單').click();await p.waitForURL(/goods-receipts\/\d+\/edit$/);await l('加入採購單行').click();await opt(/UAT-A1/).click();const line=p.getByTestId('receipt-line-0');await l('數量 *',line).fill('1');await l('倉庫 *',line).click();await opt(/^UAT-MAIN/).click();await l('庫位 *',line).click();await opt('UAT-PICK').click();await b('確認收貨並入庫').click();await b('確認入庫',dlg()).click();await p.waitForURL(/goods-receipts\/\d+$/);await p.getByText('已確認',{exact:true}).first().waitFor();return;
 }
 const origin=new URL(result.url()).origin;assert.equal(origin,'http://127.0.0.1:3100');const headers={authorization:await result.request().headerValue('authorization')};const sku=data.lines[0].skuId;assert(sku&&data.supplierId);
 const query=async()=>{const url=new URL(path.replace('/'+id,'/outstanding'),origin);url.search=new URLSearchParams({supplierId:String(data.supplierId),skuId:String(sku)});const r=await p.request.get(url.href,{headers});assert.equal(r.status(),200);return (await r.json()).data.items.find(o=>o.number===number)?.status??null;};
 const before=await query();assert.equal(before,stage==='cancel'?'CONFIRMED':'PARTIALLY_RECEIVED');const eventId=require('node:crypto').randomUUID();const r=await p.request.post(origin+path+'/'+stage,{headers:{...headers,'Idempotency-Key':eventId},data:{eventId,version:data.version,reason:'UAT 預演查驗已結束採購單排除'}});assert.equal(r.status(),200);const after=(await r.json()).data.status;assert.equal(after,stage==='cancel'?'CANCELLED':'CLOSED');const indexedAfter=await query();assert.equal(indexedAfter,null);fs.writeFileSync(u+'/evidence/final-smoke-392-'+stage+'.json',JSON.stringify({number,sku,before,after,indexedAfter},null,2),{flag:'wx'});console.log(number,before,after,indexedAfter);
});
