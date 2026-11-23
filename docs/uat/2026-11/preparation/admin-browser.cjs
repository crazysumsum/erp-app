const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(require('node:path').resolve(__dirname, '../app/node_modules/playwright'));
const u=require('node:path').resolve(__dirname, '..');
const base='http://127.0.0.1:5273';
const credentials=JSON.parse(fs.readFileSync(path.join(u,'private/accounts.json'),'utf8'));
const roles=require('./roles.json');
(async () => {
  const context=await chromium.launchPersistentContext(path.join(u,'private/browser-uat-admin'),{channel:'chrome',headless:true,baseURL:base,viewport:{width:1500,height:1000}});
  try {
    const page=context.pages()[0];
    const btn=name=>page.getByRole('button',{name,exact:true});
    await page.goto('/system/roles');
    await page.waitForURL(url=>['/login','/system/roles'].includes(url.pathname));
    if(new URL(page.url()).pathname==='/login' || await page.getByLabel('帳號',{exact:true}).isVisible()){
      await page.getByLabel('帳號',{exact:true}).fill('uat-admin');
      await page.getByLabel('密碼',{exact:true}).fill(credentials['uat-admin']);
      await btn('登入').click();
      await page.waitForURL(url=>url.pathname!=='/login');
    }
    console.log('Browser path',new URL(page.url()).pathname);
    if(new URL(page.url()).pathname==='/device/pending') return;
    await page.goto('/system/roles');
    await btn('新增角色').waitFor();
    const byName=name=>btn('「'+name+'」的操作');
    for(const [key,[display]] of Object.entries(roles)){
      if(await byName(key).count()) continue;
      await btn('新增角色').click();
      await page.getByLabel('角色名',{exact:true}).fill(key);
      await page.getByLabel('描述',{exact:true}).fill('UAT '+display);
      await page.getByRole('dialog').getByRole('button',{name:'新增',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
    }
    await byName('uat-sales').click();
    await page.getByText('配置權限',{exact:true}).click();
    const box=page.getByRole('checkbox',{name:/^sales\.mgmt —/});
    await box.waitFor();
    console.log('sales.mgmt disabled',await box.isDisabled());
    const disabled=await page.getByRole('checkbox',{disabled:true}).allTextContents();
    console.log('disabled',disabled.join(' | '));
    await page.screenshot({path:path.join(u,'evidence/role-configuration.png')});
  } finally {await context.close();}
})().catch(e=>{console.error(e.message.replaceAll(new RegExp(Object.values(credentials).join('|'),'g'),'[redacted]'));process.exitCode=1});
