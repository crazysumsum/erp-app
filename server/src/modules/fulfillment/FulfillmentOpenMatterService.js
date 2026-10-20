import { inspectFulfillmentArchiveSchemas } from "./fulfillmentArchiveDatabaseSchema.js";

const reasons = Object.freeze({nonterminalFulfillments:"FULFILLMENT_NONTERMINAL",nonterminalShipments:"SHIPMENT_NONTERMINAL",reversing:"REVERSAL_IN_PROGRESS",activeClaims:"CLAIM_ACTIVE",outstandingAllocations:"ALLOCATION_OUTSTANDING",inProgressOperations:"OPERATION_IN_PROGRESS"});
const unknown = reason => ({version:"1",status:"UNKNOWN",reasonCodes:[reason]});
const keys = (value,names) => value && Object.getPrototypeOf(value)===Object.prototype && Object.keys(value).sort().join(",")===names.split(",").sort().join(",");
function commandId(value) { if(typeof value!=="string"||value.length>16||! /^[1-9][0-9]*$/u.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))throw new TypeError("Invalid Fulfillment order ID"); }
function epoch(value) { if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw new TypeError("Invalid Fulfillment observation time"); }
export function evaluateFulfillmentOpenMatter(facts) {
  if(!keys(facts,"inconsistent,"+Object.keys(reasons).join(","))||Object.values(facts).some(value=>typeof value!=="boolean")||facts.inconsistent)return unknown("OWNER_STATE_INCONSISTENT");
  const codes=Object.entries(reasons).filter(([field])=>facts[field]).map(([,reason])=>reason);
  return {version:"1",status:codes.length?"OPEN":"CLOSED",reasonCodes:codes};
}
// Every business query is bounded to one Sales identity and returns at most one safe fact.
// Locking reads are current reads even when the caller opened its RR snapshot before taking Sales locks.
const FULFILLMENT_OPEN_MATTER_QUERIES = Object.freeze({
  nonterminalFulfillments:"SELECT 1 AS found FROM fulfillments f FORCE INDEX (idx_ful_order) WHERE f.sales_order_id=? AND f.status NOT IN ('SHIPPED','CANCELLED','REVERSED') ORDER BY f.id LIMIT 1 FOR UPDATE",
  nonterminalShipments:"SELECT 1 AS found FROM shipments s FORCE INDEX (idx_ful_shipment_order) WHERE s.sales_order_id=? AND s.status NOT IN ('SHIPPED','CANCELLED','REVERSED') ORDER BY s.id LIMIT 1 FOR UPDATE",
  reversing:"SELECT 1 AS found FROM shipments s FORCE INDEX (idx_ful_shipment_order) STRAIGHT_JOIN shipment_reversals r ON r.shipment_id=s.id WHERE s.sales_order_id=? AND r.status='REVERSING' ORDER BY r.id LIMIT 1 FOR UPDATE",
  activeClaims:"SELECT 1 AS found FROM fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_lines l ON l.fulfillment_id=f.id STRAIGHT_JOIN fulfillment_line_reservation_claims c ON c.fulfillment_line_id=l.id WHERE f.sales_order_id=? AND (c.status='ACTIVE' OR c.active_claimed_quantity>0) ORDER BY c.id LIMIT 1 FOR UPDATE",
  outstandingAllocations:"SELECT 1 AS found FROM fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_allocations a ON a.fulfillment_id=f.id WHERE f.sales_order_id=? AND (a.status IN ('ACTIVE','PARTIALLY_RELEASED') OR a.picked_base_quantity+a.released_base_quantity<>a.allocated_base_quantity) ORDER BY a.id LIMIT 1 FOR UPDATE",
  inProgressOperations:"SELECT 1 AS found FROM fulfillment_operation_requests o FORCE INDEX (idx_ful_ops_order) WHERE o.sales_order_id=? AND o.status='IN_PROGRESS' ORDER BY o.id LIMIT 1 FOR UPDATE"
});
const consistencyQueries = [
  `SELECT 1 AS found FROM fulfillments f FORCE INDEX (idx_ful_order) WHERE f.sales_order_id=? AND (f.last_business_updated_at>? OR f.line_count<>(SELECT COUNT(*) FROM fulfillment_lines l WHERE l.fulfillment_id=f.id FOR UPDATE)
    OR (f.status='CANCELLED' AND f.active_shipment_id IS NOT NULL)
    OR (f.status IN ('SHIPPED','REVERSED') AND NOT EXISTS (SELECT 1 FROM shipments s FORCE INDEX (idx_ful_shipment_order) WHERE s.id=f.active_shipment_id AND s.fulfillment_id=f.id AND (s.status=f.status OR (f.status='SHIPPED' AND s.status='REVERSING')) FOR UPDATE))) ORDER BY f.id LIMIT 1 FOR UPDATE`,
  `SELECT 1 AS found FROM fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_lines l ON l.fulfillment_id=f.id WHERE f.sales_order_id=? AND
    ((f.status='DRAFT' AND (l.allocated_base_quantity<>0 OR l.picked_base_quantity<>0 OR l.short_base_quantity<>0 OR l.shipped_base_quantity<>0 OR l.reversed_base_quantity<>0))
    OR (f.status='SHIPPED' AND (l.picked_base_quantity=0 OR l.shipped_base_quantity<>l.picked_base_quantity OR l.reversed_base_quantity<>0))
    OR (f.status='REVERSED' AND (l.shipped_base_quantity=0 OR l.reversed_base_quantity<>l.shipped_base_quantity))) ORDER BY l.id LIMIT 1 FOR UPDATE`,
  `SELECT 1 AS found FROM shipments s FORCE INDEX (idx_ful_shipment_order) STRAIGHT_JOIN fulfillments f ON f.id=s.fulfillment_id WHERE s.sales_order_id=? AND (s.last_business_updated_at>? OR s.customer_id<>f.customer_id OR s.warehouse_id<>f.warehouse_id
    OR s.line_count<>(SELECT COUNT(*) FROM shipment_lines l WHERE l.shipment_id=s.id FOR UPDATE)
    OR (s.status IN ('SHIPPED','REVERSED') AND s.status<>f.status)) ORDER BY s.id LIMIT 1 FOR UPDATE`,
  `SELECT 1 AS found FROM fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_allocations a ON a.fulfillment_id=f.id STRAIGHT_JOIN fulfillment_line_reservation_claims c ON c.id=a.claim_id WHERE f.sales_order_id=? AND
    (c.fulfillment_id<>a.fulfillment_id OR c.fulfillment_line_id<>a.fulfillment_line_id OR c.inventory_reservation_id<>a.inventory_reservation_id) ORDER BY a.id LIMIT 1 FOR UPDATE`,
  `SELECT 1 AS found FROM shipments s FORCE INDEX (idx_ful_shipment_order) STRAIGHT_JOIN shipment_reversal_details d ON d.shipment_id=s.id STRAIGHT_JOIN shipment_reversals r ON r.id=d.reversal_id STRAIGHT_JOIN shipment_issue_details i ON i.id=d.shipment_issue_detail_id
    WHERE s.sales_order_id=? AND (r.shipment_id<>d.shipment_id OR i.shipment_id<>d.shipment_id OR d.reversed_base_quantity<>i.issued_base_quantity) ORDER BY d.id LIMIT 1 FOR UPDATE`,
  `SELECT 1 AS found FROM shipments s FORCE INDEX (idx_ful_shipment_order) STRAIGHT_JOIN shipment_lines l ON l.shipment_id=s.id WHERE s.sales_order_id=? AND
    ((s.status IN ('SHIPPED','REVERSED') AND l.shipped_base_quantity<>(SELECT COALESCE(SUM(i.issued_base_quantity),0) FROM shipment_issue_details i WHERE i.shipment_line_id=l.id FOR UPDATE))
    OR (s.status='REVERSED' AND l.reversed_base_quantity<>l.shipped_base_quantity) OR (s.status='SHIPPED' AND l.reversed_base_quantity<>0)) ORDER BY l.id LIMIT 1 FOR UPDATE`,
  `SELECT 1 AS found FROM fulfillment_operation_requests o FORCE INDEX (idx_ful_ops_order) WHERE o.sales_order_id=? AND (o.is_document_archived<>0 OR (o.status='SUCCEEDED' AND o.target_id IS NULL)) ORDER BY o.id LIMIT 1 FOR UPDATE`
];
const migrations = ["migrations/0091_create_fulfillment_archive_prerequisites.js","migrations/0092_create_fulfillment_archive_mirrors.js","migrations/0093_protect_fulfillment_archive_contracts.js"];
export class FulfillmentOpenMatterService {
  constructor({database,context=database?.context,time}={}) {this.database=database;this.context=context;this.time=time;}
  async getOrderArchiveStatus(orderId,options) {
    commandId(orderId);if(!keys(options,"atMs"))throw new TypeError("Invalid Fulfillment observation options");epoch(options.atMs);
    try {
      const current=this.context?.get()?.databaseTransaction;
      if(current)return await this.getOrderArchiveStatusInTransaction(current,{orderId,atMs:options.atMs});
      const read=()=>this.database.withTransaction(tx=>this.getOrderArchiveStatusInTransaction(tx,{orderId,atMs:options.atMs}));
      return await (this.context.get()?read():this.context.storage.run({databaseTransaction:null,signal:null,auth:null,startedAt:options.atMs},read));
    } catch {return unknown("PROVIDER_UNAVAILABLE");}
  }
  async getOrderArchiveStatusInTransaction(tx,command) {
    if(!keys(command,"orderId,atMs"))throw new TypeError("Invalid Fulfillment observation command");commandId(command.orderId);epoch(command.atMs);
    if(typeof tx?.query!=="function"||this.context?.get()?.databaseTransaction!==tx)throw new TypeError("Actual bound caller transaction required");
    try {
      if(!await inspectFulfillmentArchiveSchemas(tx))return unknown("SCHEMA_MISSING");
      const [versions]=await tx.query("SELECT name FROM fr_schema_migrations WHERE name IN (?) LOCK IN SHARE MODE",[migrations]);
      if(versions.length!==migrations.length||new Set(versions.map(row=>row.name)).size!==migrations.length)return unknown("SCHEMA_VERSION_UNAVAILABLE");
      // Acquire roots/children by numeric IDs before the status predicates; retain every lock in the actual caller transaction.
      const scopes=[
        ["fulfillments r FORCE INDEX (idx_ful_order)","r.sales_order_id=?"],
        ["fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_lines r ON r.fulfillment_id=f.id","f.sales_order_id=?"],
        ["fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_lines l ON l.fulfillment_id=f.id STRAIGHT_JOIN fulfillment_line_reservation_claims r ON r.fulfillment_line_id=l.id","f.sales_order_id=?"],
        ["fulfillments f FORCE INDEX (idx_ful_order) STRAIGHT_JOIN fulfillment_allocations r ON r.fulfillment_id=f.id","f.sales_order_id=?"],
        ["shipments r FORCE INDEX (idx_ful_shipment_order)","r.sales_order_id=?"],
        ...["shipment_lines","shipment_issue_details","shipment_reversals","shipment_reversal_details"].map(table=>[`shipments s FORCE INDEX (idx_ful_shipment_order) STRAIGHT_JOIN ${table} r ON r.shipment_id=s.id`,"s.sales_order_id=?"])
      ];
      for(const [from,predicate]of scopes){let after="0",rows;do{[rows]=await tx.query(`SELECT CAST(r.id AS CHAR) AS id FROM ${from} WHERE ${predicate} AND r.id>? ORDER BY r.id LIMIT 500 FOR UPDATE`,[command.orderId,after]);if(rows.length)after=rows.at(-1).id;}while(rows.length===500);}
      const facts={inconsistent:false};
      for(const [field,sql]of Object.entries(FULFILLMENT_OPEN_MATTER_QUERIES))facts[field]=(await tx.query(sql,[command.orderId]))[0].length>0;
      for(const [index,sql]of consistencyQueries.entries())if((await tx.query(sql,[command.orderId,...([0,2].includes(index)?[command.atMs]:[])]))[0].length){facts.inconsistent=true;break;}
      return evaluateFulfillmentOpenMatter(facts);
    } catch(error) {return unknown(error.message?.startsWith("Incompatible Fulfillment schema:")?"SCHEMA_INCOMPATIBLE":"PROVIDER_UNAVAILABLE");}
  }
  async assertSalesLifecycleAllowedInTransaction(tx,command) {
    if(!keys(command,"orderId,action,eventId,expectedVersion")||!Number.isSafeInteger(command.orderId)||command.orderId<1||
      !["WITHDRAW","CANCEL","CLOSE_REMAINING"].includes(command.action)||typeof command.eventId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.eventId)||!Number.isSafeInteger(command.expectedVersion)||command.expectedVersion<1)throw new TypeError("Invalid existing Sales lifecycle command");
    return this.getOrderArchiveStatusInTransaction(tx,{orderId:String(command.orderId),atMs:this.time.nowMs()});
  }
}
