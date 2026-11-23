const assert=require('node:assert/strict');
const {operate}=require('./operator.cjs');
operate('uat-admin',async({p,b,l,u})=>{
  await p.goto('/suppliers');
  for(const code of ['UAT-SUP-A','UAT-SUP-B']){
    const row=p.getByRole('row').filter({has:p.getByRole('link',{name:'查看 '+code+' 詳情'})});
    await row.waitFor();const text=await row.innerText();assert.match(text,/啟用/); console.log(code,'active');
  }
  await p.screenshot({path:u+'/evidence/supplier-readback.png'});
  for(const code of ['UAT-A1','UAT-A2','UAT-B1','UAT-B2','UAT-C1','UAT-C2']){
    await p.goto('/items');await b('SKU').click();await p.getByRole('link',{name:'「'+code+'」的詳情'}).click();await b('停用').waitFor();
    assert.equal(await l('SKU Code *').inputValue(),code);
    for(const name of ['可採購','可銷售','計入庫存'])assert(await p.getByRole('checkbox',{name,exact:true}).isChecked());
    if(code.startsWith('UAT-A')){
      assert.equal(await l('換算係數 *').last().inputValue(),'24');assert(await p.getByRole('radio',{name:'預設銷售',exact:true}).last().isChecked());
      assert(await p.getByRole('radio',{name:'預設採購',exact:true}).last().isChecked());
    }
    if(code.startsWith('UAT-B'))assert.equal(await l('保存期限（天）*').inputValue(),'180');
    if(code==='UAT-B1')assert.equal(await l('最短到貨可用天數').inputValue(),'30');
    console.log(code,'active SKU; attributes reloaded');
  }
});
