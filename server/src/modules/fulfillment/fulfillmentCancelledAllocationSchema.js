// A known forward revision of0095; this pure module must never import that migration.
export const LEGACY_ALLOCATION_QUANTITY_CHECK="((allocated_base_quantity between 1 and 9007199254740991) and ((picked_base_quantity + released_base_quantity) <= allocated_base_quantity) and (inventory_version >= 1) and (balance_version >= 1) and (recommended_rank_snapshot >= 1))";
export const CANCELLED_ALLOCATION_QUANTITY_CHECK="((allocated_base_quantity between 1 and 9007199254740991) and (picked_base_quantity <= allocated_base_quantity) and (released_base_quantity <= allocated_base_quantity) and (((picked_base_quantity + released_base_quantity) <= allocated_base_quantity) or ((status='RELEASED') and (released_base_quantity=allocated_base_quantity))) and (inventory_version >= 1) and (balance_version >= 1) and (recommended_rank_snapshot >= 1))";
export const CANCELLED_ALLOCATION_GUARDS=Object.freeze({
 trg_ful_cancel_history_insert:["INSERT","BEGIN IF (NEW.picked_base_quantity+NEW.released_base_quantity)>NEW.allocated_base_quantity THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment Pick history overlap insert is forbidden'; END IF; END"],
 trg_ful_cancel_history_update:["UPDATE",`BEGIN
 DECLARE current_parent BIGINT UNSIGNED DEFAULT NULL;
 DECLARE effective_shipment BIGINT UNSIGNED DEFAULT NULL;
 DECLARE current_allocation BIGINT UNSIGNED DEFAULT NULL;
 DECLARE missing_row TINYINT DEFAULT 0;
 DECLARE CONTINUE HANDLER FOR NOT FOUND SET missing_row=1;
 IF OLD.picked_base_quantity>0 AND NEW.picked_base_quantity<>OLD.picked_base_quantity THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Confirmed Fulfillment Pick history is immutable'; END IF;
 IF (NEW.picked_base_quantity+NEW.released_base_quantity)>NEW.allocated_base_quantity THEN
  IF NOT (OLD.picked_base_quantity>0 AND NEW.picked_base_quantity=OLD.picked_base_quantity AND NEW.status='RELEASED' AND NEW.released_base_quantity=NEW.allocated_base_quantity) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment cancellation history quantities invalid'; END IF;
  SELECT f.id INTO current_parent FROM fulfillments f FORCE INDEX (PRIMARY) WHERE f.id=NEW.fulfillment_id AND f.status='CANCELLED' AND f.active_shipment_id IS NULL FOR SHARE NOWAIT;
  IF missing_row=1 OR current_parent IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment cancellation parent invalid'; END IF;
  SET missing_row=0;
  SELECT s.id INTO effective_shipment FROM shipments s FORCE INDEX (uq_shipment_effective) WHERE s.effective_fulfillment_id=NEW.fulfillment_id FOR SHARE NOWAIT;
  IF effective_shipment IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment cancellation Shipment exists'; END IF;
  SET missing_row=0;
  SELECT a.id INTO current_allocation FROM inventory_allocations a FORCE INDEX (PRIMARY) JOIN inventory_stock_balances b FORCE INDEX (PRIMARY) ON b.id=a.stock_balance_id WHERE a.id=NEW.inventory_allocation_id AND a.reservation_id=NEW.inventory_reservation_id AND b.id=NEW.inventory_balance_id AND a.status='RELEASED' AND a.consumed_quantity=0 AND a.outstanding_quantity=0 AND a.released_quantity=NEW.released_base_quantity AND a.allocated_quantity=NEW.allocated_base_quantity AND a.version=NEW.inventory_version AND b.version=NEW.balance_version FOR SHARE NOWAIT;
  IF missing_row=1 OR current_allocation IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment cancellation Inventory current proof invalid'; END IF;
 END IF;
END`]

});
export function cancelledAllocationSchema(base){
 if(base.table!=="fulfillment_allocations"||base.checks.chk_ful_allocation_quantity!==LEGACY_ALLOCATION_QUANTITY_CHECK)throw new TypeError("Exact0095 Allocation baseline required");
 return {...base,checks:{...base.checks,chk_ful_allocation_quantity:CANCELLED_ALLOCATION_QUANTITY_CHECK},triggers:{...Object.fromEntries(Object.entries(base.triggers).map(([name,definition])=>[name,[...definition,2]])),...Object.fromEntries(Object.entries(CANCELLED_ALLOCATION_GUARDS).map(([name,definition])=>[name,[...definition,1]]))}};
}
export function recognizeCancelledAllocationSchema(base,checks,triggers,normalize){
 if(base.table!=="fulfillment_allocations"||base.checks.chk_ful_allocation_quantity!==LEGACY_ALLOCATION_QUANTITY_CHECK)return null;
 const next=cancelledAllocationSchema(base);
 if(checks.length!==Object.keys(next.checks).length||checks.some(row=>!next.checks[row.name]||row.enforced!=="YES"||normalize(row.clause)!==normalize(next.checks[row.name]))||triggers.length!==Object.keys(next.triggers).length||triggers.some(row=>!next.triggers[row.name]||row.event!==next.triggers[row.name][0]||row.timing!=="BEFORE"||Number(row.ordinal)!==next.triggers[row.name][2]||normalize(row.statement)!==normalize(next.triggers[row.name][1])))return null;
 return next;
}
