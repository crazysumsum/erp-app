// One operator-selected action in the rehearsal browser. No database connection.
const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const [step,...args]=process.argv.slice(2);
operate('uat-finance',async({p,b,l,opt,dlg,u})=>{
  const link=name=>p.getByRole('link',{name,exact:true});
  const value=key=>p.getByText(key,{exact:true}).and(p.locator('dt')).locator('..').locator('dd');
  async function confirm(label){await b(label).click();await b(label,dlg()).click();await p.getByText('已確認',{exact:true}).first().waitFor();}
  if(step==='S08'||step==='S09'){
    const [shipment]=args;assert(shipment,'supply the full SHIPPED document number');
    const amount=step==='S08'?'225.00':'100.00';
    await p.goto('/ar/invoices/new');await l('出貨單號或銷售單號').fill(shipment);await b('搜尋已出貨').click();
    await p.getByRole('checkbox',{name:'選擇 '+shipment,exact:true}).click();
    await b('建立發票草稿').click();await p.waitForURL(/\/ar\/invoices\/\d+$/);
    await (value('總額')).waitFor();assert.equal(await value('總額').innerText(),'HKD '+amount);
    assert.match(await value('客戶').innerText(),/UAT-CUS-NORTH/);
    assert.match(await value('付款條款').innerText(),/UAT-NET30/);
    const date=new Date((await value('發票日期').innerText())+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+30);
    assert.equal(await value('到期日').innerText(),date.toISOString().slice(0,10));
    await confirm('確認發票');console.log(step,await p.locator('h1').innerText(),p.url());
  }else if(step==='S10'){
    await p.goto('/ar/receipts/new');await l('客戶及幣別').click();await opt(/UAT-CUS-NORTH.*HKD/).click();
    await l('金額').fill('325.00');await l('收款方式').click();await opt('銀行轉帳').click();
    await b('登記收款草稿').click();await p.waitForURL(/\/ar\/receipts\/\d+$/);await confirm('確認收款');
    assert.equal(await value('可核銷額').innerText(),'HKD 325.00');console.log(step,await p.locator('h1').innerText(),p.url());
  }else if(step==='S11'){
    const [receipt,id1,num1,id2,num2]=args;
    for(const v of [receipt,id1,id2])assert.match(v,/^[1-9]\d*$/);assert(num1&&num2&&num1!==num2);
    await p.goto('/ar/receipts/'+receipt);await l(num1+' 核銷金額').fill('225.00');await l(num2+' 核銷金額').fill('100.00');
    await b('核銷').click();await value('可核銷額').filter({hasText:/^HKD 0\.00$/}).waitFor();
    await p.screenshot({path:u+'/evidence/S11-receipt-'+receipt+'.png'});
    for(const [id,num] of [[id1,num1],[id2,num2]]){
      await p.goto('/ar/invoices/'+id);await p.getByRole('heading',{name:num,exact:true}).waitFor();
      assert.equal(await value('未收額').innerText(),'HKD 0.00');
      await p.screenshot({path:u+'/evidence/S11-invoice-'+id+'.png'});
    }
  }else if(step==='S12'){
    const [customerId]=args;assert.match(customerId,/^[1-9]\d*$/);
    await p.goto('/ar/aging');await l('客戶 ID').fill(customerId);await l('貨幣代碼').fill('HKD');
    const ready=p.waitForResponse(r=>{const url=new URL(r.url());return r.ok()&&url.pathname.includes('aging')&&url.searchParams.get('customerId')===customerId&&url.searchParams.get('currencyCode')==='HKD'});
    await b('查詢').click();await ready;await p.getByText('沒有未收的應收款。',{exact:true}).waitFor();
  }else throw Error('select S08, S09, S10, S11 or S12');
  await p.screenshot({path:u+'/evidence/'+step+'-'+Date.now()+'.png'});
});
