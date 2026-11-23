const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict');
const [actor,route,id,...checks]=process.argv.slice(2);
operate(actor,async({p,u})=>{
 await p.goto(route);const main=p.locator('.q-page').last();
 for(const phrase of checks){await main.getByText(phrase,{exact:false}).first().waitFor();}
 const body=await main.innerText();console.log(body.slice(-4800));assert(body.length>20);
 await p.screenshot({path:u+'/evidence/'+id+'.png',fullPage:true});
});
