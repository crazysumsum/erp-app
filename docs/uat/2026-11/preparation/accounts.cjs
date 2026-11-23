const {operate}=require('./operator.cjs');
const fs=require('node:fs'),crypto=require('node:crypto');
async function main(){
 const roles=require('./roles.json'), names=Object.keys(roles);
 const phase=process.argv[2];
 if(phase==='create')await operate('uat-admin',async({p,b,l,dlg,creds})=>{
    await p.goto('/system/users');await b('新增用戶').waitFor();await p.getByText('uat-admin',{exact:true}).first().waitFor();
    for(const key of names){
      if(await b('「'+key+'」的操作').count())continue;
      await b('新增用戶').click();await l('帳號').fill(key);await l('顯示名稱').fill(roles[key][0]);
      await l('初始密碼').fill(creds[key]);await l('確認初始密碼').fill(creds[key]);
      await p.getByRole('checkbox',{name:key,exact:true}).click();
      await l('你的密碼').fill(creds['uat-admin']);await b('新增',dlg()).click();await b('知道了').click();console.log('created',key);
    }
 });
 if(phase==='devices')for(const key of names){
    await operate(key,async({p})=>console.log(key,new URL(p.url()).pathname));
    if(process.exitCode)break;
 }
 if(phase==='approve')await operate('uat-admin',async({p,b,dlg,creds})=>{
    await p.goto('/device/approvals');await p.getByRole('heading',{name:'設備審批'}).waitFor();
    for(const key of names){
      const row=p.getByRole('row').filter({has:p.getByText(key,{exact:true})});
      await row.waitFor();
      if(!(await row.innerText()).includes('127.0.0.1'))throw Error('unexpected source for '+key);
      await b('核准',row).click();await dlg().locator('input[type=password]').fill(creds['uat-admin']);await b('核准',dlg()).click();await row.waitFor({state:'hidden'});console.log('approved',key);
    }
 });
 if(phase==='passwords')for(const key of names){
   await operate(key,async({p,b,l,creds,u})=>{
     if(new URL(p.url()).pathname!=='/password/change'){console.log(key,new URL(p.url()).pathname);return;}
     const next=crypto.randomBytes(30).toString('base64url')+'aA7!';
     fs.writeFileSync(u+'/private/'+key+'.next',next,{mode:0o600});
     await l('目前密碼').fill(creds[key]);await l('新密碼').fill(next);await l('確認新密碼').fill(next);
     await b('更新密碼').click();await p.waitForURL('**/login');creds[key]=next;
     const file=u+'/private/accounts.json';fs.writeFileSync(file+'.tmp',JSON.stringify(creds),{mode:0o600});fs.renameSync(file+'.tmp',file);
     fs.unlinkSync(u+'/private/'+key+'.next');
     await l('帳號').fill(key);await l('密碼').fill(next);await b('登入').click();await p.waitForURL(url=>url.pathname==='/');console.log('verified',key);
   });
   if(process.exitCode)break;
 }
}
main();
