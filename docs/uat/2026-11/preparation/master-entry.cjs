const {operate}=require('./operator.cjs');
operate('uat-admin',async({p,b,l,opt,dlg,u})=>{
  const type=process.argv[2];
  const input=(label,value)=>l(label,dlg()).fill(value);
  async function submit(){
    await b('新增',dlg()).click();
    await dlg().waitFor({state:'hidden'});
  }
  async function open(route,button){
    await p.goto(route);await b(button).waitFor();
    await p.locator('.q-table__progress').waitFor({state:'hidden'});
  }
  async function create(button,field,code,extra){
    if(await p.getByText(code,{exact:true}).count()) return;
    await b(button).click();await input(field,code);await extra();await submit();console.log('created',code);
  }
  if(type==='business'){
    await open('/system/business-master/currencies','新增貨幣');
    await p.getByText('HKD',{exact:true}).first().waitFor();
    await create('新增貨幣','ISO 4217 代碼','USD',()=>input('名稱','美元'));
    await open('/system/business-master/payment-terms','新增付款條款');
    for(const [code,name] of [['UAT-NET30','UAT 30 日'],['UAT-COD','UAT 即日']]) await create('新增付款條款','條款代碼',code,async()=>{
      await input('名稱',name);
      if(code.endsWith('30')){await l('到期規則').click();await opt('淨日數').click();await input('到期日數','30')}
    });
    await p.screenshot({path:u+'/evidence/business-terms.png'});
  } else if(type==='catalog'){
    await open('/items/uoms','新增單位');
    for(const [code,name] of [['EA','UAT 件'],['BOX','UAT 箱']]) await create('新增單位','代碼',code,async()=>{await input('名稱',name); await input('簡寫',code)});
    await open('/items/brands','新增品牌');await create('新增品牌','品牌名稱','UAT 樣本品牌',async()=>{});
    await open('/items/categories','新增分類');
    let parent;
    for(const name of ['UAT 測試','UAT 商品','UAT 庫存樣本']){
      await create('新增分類','分類名稱',name,async()=>{if(parent){await l('上層分類').click();await opt(new RegExp(parent)).click()}});
      parent=name;
    }
    await p.screenshot({path:u+'/evidence/item-categories.png'});
  }
});
