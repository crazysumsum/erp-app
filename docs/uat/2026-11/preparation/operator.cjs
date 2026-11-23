const fs=require('node:fs'), path=require('node:path');
const u=require('node:path').resolve(__dirname, '..');
const base='http://127.0.0.1:5273';
const {chromium}=require(u+'/app/node_modules/playwright');
const creds=JSON.parse(fs.readFileSync(u+'/private/accounts.json'));
const roles=require('./roles.json');
async function operate(name,action){
  const ctx=await chromium.launchPersistentContext(path.join(u,'private','browser-'+name),{channel:'chrome',headless:true,baseURL:base,viewport:{width:1500,height:1000}});
  const p=ctx.pages()[0], b=(n,root=p)=>root.getByRole('button',{name:n,exact:true}), l=(n,root=p)=>root.getByLabel(n,{exact:true}), opt=n=>p.getByRole('option',{name:n,exact:typeof n==='string'}), dlg=()=>p.getByRole('dialog').last();
  p.setDefaultTimeout(7000);
  const events=[];
  p.on('console',m=>{if(['error','warning'].includes(m.type()))events.push([m.type(),m.location().url.split('?')[0],m.text().slice(0,350)])});
  p.on('pageerror',err=>events.push(['error',err.message]));
  p.on('response',r=>{if(r.status()>=400)events.push([r.status(),r.request().method(),new URL(r.url()).pathname]); if(r.status()>=400)r.json().then(data=>console.log('HTTP',r.status(),new URL(r.url()).pathname,data.error?.code,data.error?.message,JSON.stringify(data.error?.details?.map?.(({path,location,message})=>({path,location,message}))))).catch(()=>{})});
  p.on('requestfailed',r=>events.push(['requestfailed',r.method(),new URL(r.url()).pathname,r.failure()?.errorText]));
  try {
    await p.goto('/');
    await p.getByRole('heading').first().waitFor();
    if(await l('帳號').isVisible() || new URL(p.url()).pathname==='/login'){
      await l('帳號').fill(name); await l('密碼').fill(creds[name]); await b('登入').click();
      await p.waitForURL(url=>url.pathname!=='/login');
    }
    await action({p,b,l,opt,dlg,creds,roles,u,name});
  }catch(e){
    const safe=Object.values(creds).reduce((msg,pw)=>msg.replaceAll(pw,'[redacted]'),e.message);
    console.error(safe);
    process.exitCode=1;
  }finally{
    const log=path.join(u,'evidence','browser-events.jsonl');
    fs.appendFileSync(log,JSON.stringify({time:new Date().toISOString(),actor:name,url:new URL(p.url()).pathname,events})+'\n');
    await ctx.close();
  }
}
module.exports={operate};
