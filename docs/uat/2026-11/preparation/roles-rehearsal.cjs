const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
operate('uat-admin',async({p,b,l,dlg,u,creds,roles})=>{
 await p.goto('/system/roles');
 async function open(name){
   await b('「'+name+'」的操作').click();await p.getByText('配置權限',{exact:true}).click();
 }
 for(const [name,[,permissions]] of Object.entries(roles)){
   await open(name);
   const wanted=permissions.split(' ');
   for(const permission of wanted){
     const box=dlg().getByRole('checkbox',{name:new RegExp('^'+permission.replaceAll('.','\\.')+' —')});
     if(!await box.isChecked())await box.click();
   }
   const selected=await dlg().getByRole('checkbox',{checked:true}).allTextContents();
   assert.deepEqual(selected.map(x=>x.split(' —')[0]).sort(),wanted.slice().sort());
   await l('原因').fill('依首期 UAT 預演角色清單配置權限');await l('你的密碼').fill(creds['uat-admin']);
   await b('儲存',dlg()).click();await dlg().waitFor({state:'hidden'});
   await open(name);
   const readback=await dlg().getByRole('checkbox',{checked:true}).allTextContents();
   assert.deepEqual(readback.map(x=>x.split(' —')[0]).sort(),wanted.slice().sort());
   await p.screenshot({path:u+'/evidence/role-verified-'+name+'.png'});
   await b('取消',dlg()).click();console.log(name,readback.length);
 }
});
