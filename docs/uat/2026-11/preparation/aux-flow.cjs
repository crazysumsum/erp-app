const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const [actor,mode,route,label,doc,expected]=process.argv.slice(2);
operate(actor,async({p,b,l,u})=>{
 const shot=id=>p.screenshot({path:u+'/evidence/'+id+'.png',fullPage:true});
 await p.goto(route);
 if(mode==='filter'){
 await l(label).fill(doc);await b('搜尋').click();await p.waitForURL(url=>url.searchParams.get('number')===doc||url.searchParams.get('q')===doc);
 if(expected==='empty')await p.getByText(/沒有符合條件的未完成銷售訂單/).waitFor();
 else {const row=p.getByRole('row').filter({hasText:expected});await row.first().waitFor();await p.reload();await row.first().waitFor();console.log((await row.allInnerTexts()).join('\n'));}
 await shot('filter-'+doc+'-'+route.split('/').pop()+'-'+expected);
 }else if(mode==='print'){
 await p.getByText(doc,{exact:false}).first().waitFor();await p.getByRole('row').filter({hasText:'UAT-C1'}).first().waitFor();await p.emulateMedia({media:'print'});await p.pdf({path:u+'/evidence/'+label+'.pdf',format:'A4',preferCSSPageSize:true});await p.emulateMedia({media:'screen'});await p.evaluate(()=>{window.addEventListener('beforeprint',()=>document.documentElement.dataset.uatPrint='opened',{once:true});});await b('列印 A4').click();await p.waitForFunction(()=>document.documentElement.dataset.uatPrint==='opened');
 console.log(label,doc,(await p.locator('table').first().innerText()).slice(-500));
 }else if(mode==='limit1'){await p.getByText('已出貨',{exact:true}).first().waitFor();assert.equal(await p.getByRole('button',{name:/沖銷|撤回出貨/}).count(),0);await shot('limit1-shipped');}
});
