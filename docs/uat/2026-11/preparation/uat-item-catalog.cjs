require('./operator.cjs').operate('uat-admin',async({p,b,l,dlg})=>{
 for(const [route,label,field,value] of [['/items/categories','新增分類','分類名稱','合成範例分類'],['/items/brands','新增品牌','品牌名稱','合成範例品牌']]){
   await p.goto(route);await b(label).waitFor();await p.getByText(route.includes('categories')?'UAT 庫存樣本':'UAT 樣本品牌',{exact:true}).first().waitFor();const entry=p.getByText(value,{exact:true});
   if(await entry.count()===0){await b(label).click();await l(field,dlg()).fill(value);await b('新增',dlg()).click();await dlg().waitFor({state:'hidden'});}
   await entry.first().waitFor();console.log(value,'可讀回');
 }
});
