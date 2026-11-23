const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
operate('uat-admin',async({p,u})=>{
 const resp=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/customers'&&r.status()===200);await p.goto('/customers');const list=await resp;
 const origin=new URL(list.url()).origin;assert(['http://127.0.0.1:3100','http://127.0.0.1:5273'].includes(origin));
 const headers={authorization:await list.request().headerValue('authorization')};assert(headers.authorization);
 async function get(path){const res=await p.request.get(origin+'/api/v1/'+path,{headers});assert.equal(res.status(),200);return (await res.json()).data;}
 const terms=(await get('business-master/payment-terms')).items, customers=(await list.json()).data.items;
 for(const [code,term] of [['UAT-CUS-NORTH','UAT-NET30'],['UAT-CUS-ORBIT','UAT-COD']]){
 const id=customers.find(x=>x.code===code).id,termId=terms.find(x=>x.code===term).id;
 const path='customers/'+id,customer=await get(path);assert.equal(customer.code,code);
 if(customer.defaultPaymentTermId!==termId){const data=Object.fromEntries(['legalName','tradingName','defaultCurrencyCode','accountManagerUserId','categoryId','industryId','territoryId','generalPhone','generalEmail','website','notes','version'].map(k=>[k,customer[k]]));
 Object.assign(data,{defaultPaymentTermId:termId,reason:'UAT 預演客戶預設付款條款'});const res=await p.request.post(origin+'/api/v1/'+path+'/update',{data,headers:{...headers,'Idempotency-Key':randomUUID()}});assert(res.ok(),res.status()+' '+JSON.stringify((await res.json()).error));}
 assert.equal((await get(path)).defaultPaymentTermId,termId);console.log(code,term,'readback OK');}
});
