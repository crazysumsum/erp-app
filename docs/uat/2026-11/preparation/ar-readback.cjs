const u=require('node:path').resolve(__dirname, '..'), assert=require('node:assert/strict'),fs=require('node:fs');
require(u+'/preparation/operator.cjs').operate('uat-finance',async({p})=>{
 const receipt='RCT-2026-000001', result={receipt,allocations:[]};
 const field=label=>p.locator('dl dt').getByText(label,{exact:true}).locator('..').locator('dd');
 const val=label=>p.locator('dt').filter({hasText:new RegExp('^'+label+'$')}).locator('..').locator('dd').innerText();
 await p.goto('/ar/receipts');await p.getByRole('row').filter({hasText:receipt}).waitFor();
 await p.goto('/ar/receipts/1');await p.reload();await p.getByRole('heading',{name:receipt}).waitFor();
 result.amount=await val('金額');result.applied=await val('已核銷');result.available=await val('可核銷額');
 assert.deepEqual([result.amount,result.applied,result.available],['HKD 325.00','HKD 325.00','HKD 0.00']);
 for(const [id,amount] of [[1,'225.00'],[2,'100.00']]){
   const num='INV-2026-00000'+id;
   const row=p.getByRole('row').filter({hasText:num});await row.waitFor();const txt=await row.innerText();assert(txt.includes('HKD '+amount)&&txt.includes('HKD 0.00')&&txt.includes('有效'));
   await row.getByRole('link',{name:num}).click();await p.getByRole('heading',{name:num}).waitFor();assert.equal(await val('未收額'),'HKD 0.00');assert.equal(await val('已核銷'),'HKD '+amount);
   await p.getByRole('row').filter({hasText:receipt}).waitFor();result.allocations.push({invoice:num,applied:amount,outstanding:'0.00',active:true});await p.goto('/ar/receipts/1');
 }
 const rep=p.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/api/v1/ar-aging'&&url.searchParams.get('customerId')==='1'&&url.searchParams.get('currencyCode')==='HKD'&&r.ok()});
 await p.goto('/ar/aging?customerId=1&currencyCode=HKD');const body=(await (await rep).json()).data;
 await p.getByText('沒有未收的應收款。',{exact:true}).waitFor();assert.deepEqual(body.items,[]);assert.equal(await p.getByTestId('ar-aging-row').count(),0);
 result.aging={customerId:1,currencyCode:'HKD',asOfDate:body.asOfDate,items:body.items,totals:body.totals};
 fs.writeFileSync(u+'/evidence/S10-S12-388-readback.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(result);
});
