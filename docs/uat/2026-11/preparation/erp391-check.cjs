const u=require('node:path').resolve(__dirname, '..'),assert=require('node:assert/strict');
require(u+'/preparation/operator.cjs').operate('uat-buyer',async({p,b,l,opt})=>{
 await p.goto('/purchasing/purchase-orders/4/edit');const banner=p.getByRole('alert').filter({hasText:'此採購單的供應商已封鎖。請更換供應商並儲存草稿後再提交。'});await banner.waitFor();await p.screenshot({path:u+'/evidence/final-smoke-391-blocked.png'});
 await l('供應商 *').fill('UAT-SUP-A');await opt('UAT-SUP-A — UAT 正常供應商有限公司').click();await require(u+'/app/node_modules/@playwright/test').expect(b('提交')).toBeDisabled();
 const saved=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/purchase-orders/4/update'&&r.request().method()==='POST');await b('儲存草稿').click();assert((await saved).ok());await p.reload();await b('提交').waitFor();
 await require(u+'/app/node_modules/@playwright/test').expect(b('提交')).toBeEnabled();assert.equal(await banner.count(),0);await p.screenshot({path:u+'/evidence/final-smoke-391-saved.png'});console.log('blocked draft guidance, supplier replacement, save and submit availability verified');
});
