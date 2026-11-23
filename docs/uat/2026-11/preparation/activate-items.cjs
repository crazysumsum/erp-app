const {operate}=require('./operator.cjs');
operate('uat-admin',async({p,b,l,opt,dlg,u})=>{
 for(const code of ['UAT-A1','UAT-A2','UAT-B1','UAT-B2','UAT-C1','UAT-C2']){
   await p.goto('/items'); await b('SKU').click();
   const detail=p.getByRole('link',{name:'「'+code+'」的詳情',exact:true}); await detail.click();
   await b('編輯').waitFor();
   for(const name of ['可採購','可銷售','計入庫存']) if(!await p.getByRole('checkbox',{name,exact:true}).isChecked())throw Error('missing '+name+' '+code);
   if(!await b('停用').isVisible() && /UAT-[AB]/.test(code)){
     await b('編輯').click();
     if(code.startsWith('UAT-A')){
       if(await l('單位 *').count()===1){
         await b('新增單位').click(); await l('單位 *').last().click(); await opt(/BOX/).click();
       }
       await l('換算係數 *').last().fill('24');
       await p.getByRole('radio',{name:'預設採購',exact:true}).last().click();
       await p.getByRole('radio',{name:'預設銷售',exact:true}).last().click();
     }else{
       if(!await l('保存期限（天）*').count()){await l('追蹤政策').click();await opt('追蹤批號及效期').click()}
       await l('保存期限（天）*').fill('180');
       if(code==='UAT-B1')await l('最短到貨可用天數').fill('30');
     }
     await l('修改原因（改 Base 單位、換算係數或追蹤政策時必填）').fill('首期 UAT 樣本單位及效期');
     await b('儲存').click();await b('編輯').waitFor();
   }
   await p.getByRole('link',{name:'返回商品',exact:true}).click(); await b('編輯').waitFor();
   if(await b('啟用').count()){
     await b('啟用').click(); await l('啟用原因').fill('首期 UAT 合成主資料啟用'); await b('啟用',dlg()).click(); await dlg().waitFor({state:'hidden'});
   }
   await p.reload();await b('停用').waitFor();console.log(code,'parent active');
   await p.screenshot({path:u+'/evidence/item-'+code+'.png'});
 }
});
