const path=require('node:path');
const {operate}=require('./operator.cjs');
operate('uat-admin',async({p,b,l,opt,dlg,creds,u})=>{
 const kind=process.argv[2];
 const [route,file,upload,mode,n]={
   items:['/items/imports','01-item-import.csv','上傳',null,6],
   customers:['/customer-imports','04-customers.csv','上傳','寫入狀態',3],
   suppliers:['/suppliers/imports','05-suppliers.csv','上載','新增供應商狀態',2]
 }[kind];
 await p.goto(route);
 if(process.argv[3]) {await b('工作 #'+process.argv[3]+' 的詳情').click();}
 else{
   await b(upload+' CSV').click();
   await p.locator('input[type=file]').setInputFiles(path.join(__dirname,file));
   await b(upload,dlg()).click();
   if(kind!=='suppliers') await p.getByRole('button',{name:/工作 #\d+ 的詳情/}).first().click();
 }
 const detail=p.getByRole('dialog').filter({has:p.getByRole('heading',{name:/匯入工作/})});
 const status=detail.getByText(/^(待確認.*|預檢不通過|已完成.*|失敗|執行失敗)$/).first();
 await status.waitFor({timeout:40000});
 const initial=await status.innerText();
 const counts=detail.getByText(new RegExp('^共\\s*'+n+'\\s*列'));
 console.log(kind,initial,(await detail.innerText()).slice(0,1400));
 if(!(await detail.innerText()).includes('共 '+n+' 列'))throw Error('匯入列數與輸入不符');
 if(initial==='已完成')return;
 if(initial!=='待確認'){console.log((await detail.innerText()).slice(0,2600));throw Error('預檢沒有全部通過')}
 if(mode){await l(mode).click();await opt('啟用').click();}
 await b('確認匯入',detail).click();
 const prompt=dlg();
 if(kind==='items')await prompt.getByRole('textbox').first().fill('首期 UAT 合成貨品資料');
 await prompt.locator('input[type=password]').fill(creds['uat-admin']);
 const confirmed=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/confirm') && r.request().method()==='POST');
 await b('確認匯入',prompt).click();
 const res=await confirmed; if(!res.ok()){await p.screenshot({path:u+'/evidence/import-'+kind+'-rejected.png',mask:[p.locator('input[type=password]')]});throw Error('confirmation HTTP '+res.status());}
 await detail.getByText(/^已完成|執行失敗|^失敗$/).first().waitFor({timeout:40000});
 console.log(kind,(await detail.innerText()).split('\n').filter(s=>s.includes('列')&&s.includes('失敗')).join(' '));
 await p.screenshot({path:u+'/evidence/import-'+kind+'.png'});
 if(!await detail.getByText('已完成',{exact:true}).count())throw Error('匯入帶錯誤');
});
