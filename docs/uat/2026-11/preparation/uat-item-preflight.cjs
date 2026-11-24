const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const file=process.argv[2];
const digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(digest,'2d88e9fef6907c9c5dea34a37c04d3bb3c39260d3b5579dc8031c6d987600ade');
require('./operator.cjs').operate('uat-admin',async({p,b,dlg,u})=>{
 await p.goto('/items/imports');await b('上傳 CSV').click();await p.locator('input[type=file]').setInputFiles(file);
 const posted=p.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/item-import'));
 await b('上傳',dlg()).click();const r=await posted;assert(r.ok());const body=(await r.json()).data, id=body.id??body.job?.id;console.log('job',id,Object.keys(body));
 await b('工作 #'+id+' 的詳情').click();
 const detail=p.getByRole('dialog').filter({has:p.getByRole('heading',{name:/匯入工作/})});
 await detail.getByText(/^(待確認.*|預檢不通過|失敗)$/).first().waitFor({timeout:40000});const result=await detail.innerText();
 fs.writeFileSync(u+'/evidence/item-template-1124.txt',digest+'\n'+result+'\n');await p.screenshot({path:u+'/evidence/item-template-1124.png'});console.log(result);
});
