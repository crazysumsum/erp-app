const {operate}=require('./operator.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [warehouse,stage]=process.argv.slice(2);
assert(['UAT-MAIN','UAT-SECOND'].includes(warehouse)&&['pick-list','outbound'].includes(stage));
operate('uat-warehouse', async ({p,b,l,u})=>{
 const dir=path.join(u,'evidence/two-warehouse');
 const s=JSON.parse(fs.readFileSync(path.join(dir,warehouse+'.json')));
 const link=name=>p.getByRole('link',{name,exact:true});
 const snap=tag=>p.screenshot({path:path.join(dir,warehouse+'-'+tag+'.png')});
 if(stage==='pick-list'){
   await p.goto('/fulfillments/'+s.fulfillmentId);await p.getByText('揀貨中',{exact:true}).first().waitFor();await link('揀貨單列印').click();await p.waitForURL(/pick-list\/print$/);
   const row=p.getByRole('row').filter({hasText:s.lot}).filter({hasText:s.expiry}).filter({hasText:s.bin}).filter({hasText:s.sku});assert((await row.innerText()).includes('2 EA'));await snap(stage);return;
 }
 await p.goto('/shipments');await l('出貨單／SO 編號（精確）').fill(s.shipment);await b('搜尋').click();await link('查看 '+s.shipment).click();await p.getByText('已出貨',{exact:true}).first().waitFor();await p.getByRole('tab',{name:'庫存發出明細'}).click();
 const row=p.getByRole('row').filter({hasText:s.lot}).filter({hasText:s.expiry}).filter({hasText:s.bin}).filter({hasText:s.sku});await row.getByText('2 EA',{exact:true}).waitFor();const movement=(await row.getByRole('link').innerText()).trim();assert(/^\d+$/.test(movement));await snap('issue-query');await row.getByRole('link').click();
 await p.getByRole('heading',{name:'Movement '+movement+' 詳情'}).waitFor();const movementRow=p.getByRole('row').filter({has:p.getByRole('button',{name:'查看同組 Movement '+movement,exact:true})});for (const value of ['OUT','2',s.lot,s.warehouse+'/'+s.bin]) await movementRow.getByText(value,{exact:true}).waitFor();await snap('movement-query');
 await p.goto('/shipments/'+s.shipId+'/delivery-note/print');await p.getByRole('row').filter({hasText:s.sku}).getByText('2 EA',{exact:true}).waitFor();await p.getByText(s.shipment,{exact:false}).first().waitFor();await snap('delivery-print');
 await p.goto('/shipments/'+s.shipId+'/delivery-note/print?view=packing');const packed=p.getByRole('row').filter({hasText:s.lot}).filter({hasText:s.expiry}).filter({hasText:s.bin});await packed.getByText('2 EA',{exact:true}).waitFor();await snap('packing-print');
 fs.writeFileSync(path.join(dir,warehouse+'-readback.json'),JSON.stringify({shipment:s.shipment,movement,warehouse,bin:s.bin,lot:s.lot,expiry:s.expiry,quantity:2},null,2));
});
