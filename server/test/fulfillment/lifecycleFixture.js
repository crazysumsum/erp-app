import {randomUUID} from "node:crypto";
import {fixture} from "./aggregateFixture.js";
import {up as shipmentUp} from "../../database/migrations/0096_create_shipments.js";
import {up as factsUp} from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import {up as auditUp} from "../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import {up as archiveUp} from "../../database/migrations/0099_create_fulfillment_archives.js";
import {FulfillmentOpenMatterService} from "../../src/modules/fulfillment/FulfillmentOpenMatterService.js";
import {SalesOrderLifecycleService} from "../../src/modules/sales/SalesOrderLifecycleService.js";
async function lifecycleFixture(t){
  const f=await fixture(t);f.time.fileDate=()=>"2023-11-14";await shipmentUp(f.db);await factsUp(f.db);await auditUp(f.db);await archiveUp(f.db);
  await f.db.execute("UPDATE sales_orders SET sales_order_number='SO-202610-000001' WHERE id=?",[f.s.orderId]);
  await f.db.execute("DELETE FROM role_permissions WHERE role_id=?",[f.roleId]);
  for(const name of ["sales.view","sales.mgmt"])await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name=?",[f.roleId,name]);
  const jwt={sub:String(f.userId),roles:[f.label],permissions:["sales.mgmt","sales.view"]},claims={actorId:f.userId,claimedRoles:jwt.roles,claimedPermissions:jwt.permissions},provider=new FulfillmentOpenMatterService({database:f.database}),services={names:()=>["fulfillmentOpenMatter"],resolve:async()=>provider};
  const run=work=>f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:jwt}},work),service=new SalesOrderLifecycleService({database:f.database,time:f.time,logger:{error(){}},services});
  const input=()=>({claims,id:f.s.orderId,input:{eventId:randomUUID(),version:1,reason:"Synthetic cancellation"}}),command=()=>({orderId:f.s.orderId,action:"CANCEL",eventId:randomUUID(),expectedVersion:1});
  return {...f,jwt,claims,provider,services,service,run,input,command};
}
export {lifecycleFixture};
