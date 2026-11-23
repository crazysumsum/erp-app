const u=require('node:path').resolve(__dirname, '..');
const {operate}=require(u+'/preparation/operator.cjs'), fs=require('node:fs'), assert=require('node:assert/strict');
operate('uat-finance',async({p,l,b,opt})=>{
 const reply=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/ar-aging'&&r.ok());
 await p.goto('/ar/aging');
 const raw=(await (await reply).json()).data;
 const record=raw.items.find(x=>x.customerCode==='UAT-CUS-NORTH'&&x.currencyCode==='HKD');assert(record);
 const row=p.getByTestId('ar-aging-row').filter({hasText:'UAT-CUS-NORTH'});await row.waitFor();
 const cells=await row.getByRole('cell').allTextContents();
 assert.equal(Number(record.invoiceCount),2);assert.equal(Number(record.notDue),325);assert.equal(Number(record.total),325);
 assert.deepEqual(cells.slice(1),['HKD','2','325.00','0.00','0.00','0.00','0.00','325.00']);
 console.log('customerId',record.customerId);await p.screenshot({path:u+'/evidence/S10-aging-before.png'});
 await p.goto('/ar/receipts/new');await l('客戶及幣別').click();await opt(/UAT-CUS-NORTH.*HKD/).click();
 await l('金額').fill('325.001');await p.getByText(/請輸入大於零、最多 2 位/).waitFor();assert(await b('登記收款草稿').isDisabled());
 fs.writeFileSync(u+'/evidence/S10-before.json',JSON.stringify({record,cells,invalidPrecisionBlocked:true},null,2),{flag:'wx'});
});
