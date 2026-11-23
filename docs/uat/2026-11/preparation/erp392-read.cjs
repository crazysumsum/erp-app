const u=require('node:path').resolve(__dirname, '..'),assert=require('node:assert/strict'),fs=require('node:fs');
const phase=process.argv[2],info=JSON.parse(fs.readFileSync(u+'/evidence/final-smoke-context.json'));
require(u+'/preparation/operator.cjs').operate('uat-warehouse',async({p})=>{
 const resp=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/purchase-orders/'+info.poId&&r.ok());await p.goto('/purchasing/purchase-orders/'+info.poId);const current=await resp;
 const auth=await current.request().headerValue('authorization');assert(auth);const api=new URL(current.url());assert.equal(api.origin,'http://127.0.0.1:3100');api.pathname='/api/v1/purchase-orders/outstanding';
 const results=[];
 for(const [sku,day,hit] of [[1,'2026-11-27',true],[1,'2026-11-28',false],[4,'2026-11-29',true],[4,'2026-11-28',false]]){
   api.search=new URLSearchParams({supplierId:'1',skuId:String(sku),expectedDeliveryDateFrom:day,expectedDeliveryDateTo:day}).toString();
   const r=await p.request.get(api.href,{headers:{authorization:auth}});assert.equal(r.status(),200);const {items}= (await r.json()).data;
   const match=items.find(x=>Number(x.id)===info.poId);
   assert.equal(Boolean(match),phase!=='complete'&&hit);
   if(match)assert.equal(match.status,phase==='partial'?'PARTIALLY_RECEIVED':'CONFIRMED');
   results.push({sku,day,order:match?.number??null,status:match?.status??null});
 }
 fs.writeFileSync(u+'/evidence/final-smoke-392-'+phase+'.json',JSON.stringify(results,null,2),{flag:'wx'});console.log(phase,results);
});
