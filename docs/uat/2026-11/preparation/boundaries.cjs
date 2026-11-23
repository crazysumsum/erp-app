const {operate}=require('./operator.cjs');
const assert=require('node:assert/strict'),fs=require('fs');
const pages={'/sales/orders':'sales.view','/sales/orders/new':'sales.mgmt','/fulfillment/queue':'fulfillment.view','/purchasing/approvals':'purchasing.approval','/purchasing/settings':'purchasing.settings','/purchasing/purchase-orders/new':'purchasing.mgmt','/inventory/adjustments':'inventory.adjust','/inventory/warehouses':'inventory.view','/suppliers/approvals':'supplier.approval','/customers/new':'customer.mgmt','/system/roles':'role.mgmt'};
(async()=>{for(const name of process.argv.slice(2))await operate(name,async({p,roles,u,b})=>{
 const perms=roles[name][1].split(' '), evidence={name,denied:[],actions:[]};
 for(const [route,perm] of Object.entries(pages)){
 if(perms.includes(perm))continue;
 const gated=p.locator('a[href="'+route+'"]:visible');assert.equal(await gated.count(),0,route+' visible in navigation');
 await p.goto(route);await p.waitForURL('**/403');evidence.denied.push(route);
 }
 if(perms.includes('purchasing.view')&&!perms.includes('purchasing.approval')){await p.goto('/purchasing/purchase-orders/2');await p.getByRole('heading',{name:'PO-202611-000002'}).waitFor();assert.equal(await b('批准').count(),0);evidence.actions.push('PO detail: no approval button');}
 if(perms.includes('fulfillment.view')&&!perms.includes('fulfillment.operation')){await p.goto('/fulfillment/queue');await p.getByRole('heading').first().waitFor();assert.equal(await p.getByRole('button',{name:/建立履約工作/}).count(),0);evidence.actions.push('queue: no create action');}
 if(perms.includes('inventory.view')&&!perms.includes('inventory.mgmt')){await p.goto('/inventory/warehouses');await p.getByRole('button',{name:'查看倉庫 UAT-MAIN 的庫位'}).waitFor();assert.equal(await b('新增倉庫').count(),0);evidence.actions.push('warehouse list: no create action');}
 fs.writeFileSync(u+'/evidence/boundaries-'+name+'.json',JSON.stringify(evidence,null,2));console.log(name,evidence.denied.length,evidence.actions);
 });})();
