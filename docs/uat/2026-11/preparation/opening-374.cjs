const {operate}=require('./operator.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
const [phase]=process.argv.slice(2);
operate('uat-inventory',async({p,b,l,dlg,u,creds})=>{
 await p.goto('/inventory/opening');const file=phase==='invalid'?'03-opening-invalid.csv':'02-opening-valid.csv';
 await l('CSV 檔案（必填）').setInputFiles(u+'/preparation/'+file);const upload=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/inventory/opening'));await b('上傳預檢').click();const r=await upload;assert(r.ok(),r.status());const job=(await r.json()).data;
 console.log('job',job);await p.getByText(new RegExp('匯入 #'+job.id+' ·')).waitFor();await p.screenshot({path:u+'/evidence/opening-'+phase+'-precheck.png'});const log={job};const save=()=>fs.writeFileSync(u+'/evidence/opening-'+phase+'.json',JSON.stringify(log,null,2));save();
 if(phase==='invalid'||phase==='duplicate'){
 assert.equal(job.status,'INVALID');assert.equal(job.readyRows,0);assert.equal(await b('核對並確認').count(),0);
 if(phase==='invalid'){assert.deepEqual(job.errors.map(x=>[x.row,x.code]),[[2,'LOT_REQUIRED'],[3,'OPENING_DUPLICATE_BUCKET'],[4,'OPENING_DUPLICATE_BUCKET']]);}else assert.equal(job.errors.filter(x=>x.code==='OPENING_POSITION_OCCUPIED').length,8);return;}
 assert.equal(phase,'valid');assert.equal(job.status,'READY');assert.equal(job.readyRows,8);assert.deepEqual(job.skippedRows,[10]);await l('入帳原因（必填）').fill('UAT 期初預演，核對八筆庫存合計 552 EA');await b('核對並確認').click();await l('目前密碼（必填）').fill(creds['uat-inventory']);const result=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/confirm'));await b('確認過帳',dlg()).click();const res=await result;assert(res.ok(),res.status());log.confirm=(await res.json()).data;save();await p.getByText(/已完成入帳 · 8 筆/).waitFor();await p.reload();await p.getByText(/已完成入帳 · 8 筆/).waitFor();await p.screenshot({path:u+'/evidence/opening-completed.png'});console.log('completed',log.confirm);
});
