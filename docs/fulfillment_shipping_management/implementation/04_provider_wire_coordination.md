# P0 provider wire — engineering coordination

Status: proposed exact DTOs for owner/consumer review; not Checkpoint0B or implemented-source acceptance. This completes the serialization detail of design§6 without changing business quantities, data ownership, lock order or delivery scope. Sales owner handoff113 and its original reserve-identity constraints remain authoritative for Sales internals.

## Shared boundary

IDs and Base UOM quantities are canonical unsigned decimal strings, no leading zeros (except quantity `"0"` where explicitly allowed), within Number.MAX_SAFE_INTEGER before conversion. Versions are positive safe integer Numbers, timestamps nonnegative safe integer epoch milliseconds. Each provider validates its fixed method purpose and fresh user actor; neither caller-selected privilege nor a service-name bearer grants business authority. Every write uses the caller's real transaction and never commits/rolls back it.

Selected Shipment lines are explicit, sorted by `salesOrderLineId`, including fully short-picked lines represented as `baseQuantity:"0", reservations:[]`. The document must have at least one positive line. Exact-set means precisely those selected line IDs, not every line of the SO. Reservation members are positive, sorted by `inventoryReservationId`, unique within the Shipment, and their sum equals their line quantity. Inventory derives bucket identity from its own original allocation/movement; caller cannot choose a reversal destination.

## Item batch

`ItemLookupService.getFulfillmentInventoryProfilesInTransaction(tx, skuIds, {atMs})` accepts at most100 unique decimal-string IDs, numerically sorts them and takes the existing owner UOM→Item→SKU→mapping locking strategy once for the full set. It returns an immutable sorted array (JSON-compatible), one entry for each requested SKU or fail-closed:

```js
{ skuId:"12", skuVersion:3, itemId:"10", itemVersion:2,
  skuCode:"SYNTHETIC", skuName:"Synthetic", skuStatus:"active", itemStatus:"active",
  inventoryTracked:true, trackingPolicy:"batch", minimumSaleLifeDays:0,
  baseUom:{uomId:"7",uomCode:"EA",version:1}, usable:true, reasons:[] }
```

Use the current Item inventory-purpose evaluator; do not impose new-sale price/sellable rules or raw-read Item tables from Sales. Serial/unusable facts are rejected at Fulfillment submit points. Existing single-SKU provider behavior is preserved. Versions in the result come from the same locked current rows as the Base UOM identity.

## Inventory Issue input

`postFulfillmentIssueBatchInTransaction(tx, command)` fixes purpose `fulfillment.issue`, source module `FULFILLMENT` (the persisted Inventory source tuple is uppercase), source document type `SHIPMENT`, source documentId=shipmentId. Payload:

```js
{ fulfillmentId:"101", shipmentId:"201", lines:[
  { fulfillmentLineId:"111", salesOrderLineId:"901", baseQuantity:"6", reservations:[
    { claimId:"121", inventoryReservationId:"301", expectedVersion:4, baseQuantity:"6",
      allocations:[{inventoryAllocationId:"401",inventoryBalanceId:"501",
        expectedVersion:2,expectedBalanceVersion:5,baseQuantity:"6"}] }
  ] },
  { fulfillmentLineId:"112",salesOrderLineId:"902",baseQuantity:"0",reservations:[] }
] }
```

The trusted Fulfillment consumer supplies the selected persisted picked projection. Inventory additionally derives the complete outstanding allocation set owned by this Fulfillment from Inventory allocation/create-operation sources (`FULFILLMENT/PICK`, documentId=fulfillmentId, source lineId=claimId); input must equal that set with exact outstanding quantities after Short Pick release. Enumeration admits only members verified against their completed dedicated Fulfillment batch root, request hash and complete digest; generic ALLOCATION_CREATE/ISSUE_POST rows merely labelled with a matching source tuple are excluded. It verifies reservation/warehouse/SKU ownership, quantities and expected versions. Every Inventory operation row for the whole batch is claimed before its Inventory warehouse/control/bucket/reservation/allocation locks; all lock classes are acquired as complete numerically sorted sets. Per-reservation source identity for Issue is `FULFILLMENT/SHIPMENT`, documentId=shipmentId, lineId=claimId, eventId=original command event.

## Inventory Issue result

```js
{ operationId:"601", lines:[
  { fulfillmentLineId:"111",salesOrderLineId:"901",baseQuantity:"6",reservations:[
    { claimId:"121",inventoryReservationId:"301",expectedVersion:4,version:5,
      baseQuantity:"6",inventoryOperationId:"602",allocations:[
        {inventoryAllocationId:"401",inventoryBalanceId:"501",movementId:"701",
         baseQuantity:"6",allocationVersion:3,balanceVersion:6,
         bucketSnapshot:{warehouseId:"2",warehouseCode:"WH",binId:"3",binCode:"A",
           lotId:"4",lotNumber:"LOT",expiryDate:"2026-12-31",stockStatus:"AVAILABLE",
           skuId:"12",skuCode:"SYNTHETIC",skuName:"Synthetic",baseUomId:"7",baseUomCode:"EA",postedAt:1792486800000}}
      ] }
  ] },
  {fulfillmentLineId:"112",salesOrderLineId:"902",baseQuantity:"0",reservations:[]}
] }
```

One successful member changes its Reservation version once (`version=expectedVersion+1`). Every allocation includes the owner-safe immutable bucketSnapshot from the actual Movement/locked owner profile, sufficient for Shipment Issue details without an extra raw Inventory read. Reverse results include the same original bucket identity plus actual reversal postedAt. Warehouse/bin/lot/SKU/UOM IDs/codes, expiry/status and Base UOM fields are preserved; lotId/expiry may be null.

All input references to one Balance must agree with its **initial** locked expectedBalanceVersion. Actual per-movement balanceVersion increments in canonical member/allocation execution order; a later member must not be rejected merely because this same batch already changed that Balance. Replays preserve those original actual versions and snapshots in compact member/movement receipts, not current recomputation.

Movement/allocation/balance versions are actual provider results; no caller increment is used as proof. Root operationId identifies the entire batch; each member inventoryOperationId identifies its real Inventory Issue operation, which Sales can verify against current Inventory rows/source. Successful replay returns the exact committed result using immutable operation/member receipts rather than recalculating current versions.

## Dedicated Reverse+Restore

`reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx, command)` fixes purpose `fulfillment.reverse`, requires fresh `fulfillment.view`+`fulfillment.reverse`, source `FULFILLMENT/SHIPMENT`, documentId=the original shipmentId, new reversal eventId. Same outer selected line/reservation shape, with original positive quantity. Each reservation member additionally supplies `originalInventoryOperationId`; each allocation member supplies `shipmentIssueId` (owner's persisted opaque reference), `originalMovementId`, `inventoryAllocationId`, `expectedBalanceVersion`. No bucket/location/target fields are accepted. Member expectedVersion is the current Reservation version before restore, and response version is actual restored version (one increment).

Inventory verifies all original Issue movements and operation/source identity belong to the original Shipment, that the supplied movement set is complete and unique, original quantities match and none has already reversed. It derives the original bucket and original Allocation/Reservation solely from its own immutable rows, revalidates active Bin/non-counting/Lot/Status and restores the original Reservation consumed→outstanding. Allocation remains Consumed. Database unique reversal-of-movement ensures at most one reverse. The result uses the Issue result shape with each allocation carrying `shipmentIssueId`, `originalMovementId`, new `movementId`, actual versions, and the same member `baseQuantity`; Sales also receives the original operation reference to preserve original Sales reserve identities and verify restoration.

The opaque shipmentIssueId is bound in the command/receipt, not asserted by Inventory to exist in another owner's table. Fulfillment validates that reference against its own locked Issue detail before this call; Inventory validates its immutable movement/source tuple. Before any effects, the full exact movement set for the original Shipment is checked from Inventory-owned completed dedicated Issue batch roots and verified members, excluding generic caller-labelled Issue operations. Already reversed original movements reject safely; existing generic Inventory-only reversal semantics remain unchanged and any resulting projection mismatch is a reconciliation obligation. Zero lines remain explicit in both directions.

## Sales two-stage coordination

The Sales locking method receives the same selected lines/reservation quantities and expected Inventory versions as immutable pre-Inventory intent; it may claim its dedicated0069 journal before Sales locks. Its private transaction receipt and full intent hash bind action, source, shipment, SO/line versions, zero lines and the exact member set. A pure locking-read use has no result intent/journal. Completed Sales replay returns original result before another Inventory call.

After Inventory, Sales apply consumes that exact receipt and result lines above, verifies each real Inventory operation/source/current projection and stores the completed apply hash/result. It must not overwrite0078 original reservation operation/event IDs. Consumer maps `inventoryOperationId`/`version` to the existing design§6.1 reservation result names; the complete Inventory result remains available for validation. No new Sales operation is claimed after Inventory locks. Engineering details of the private receipt are owned by Sales; they are not serialized as an HTTP caller capability.

## Receipt identity refinement

Inventory root command types are `FULFILLMENT_BATCH_ALLOCATE`, `FULFILLMENT_BATCH_RELEASE`, `FULFILLMENT_BATCH_REALLOCATE`, `FULFILLMENT_BATCH_ISSUE`, `FULFILLMENT_BATCH_REVERSE`; member command types retain `ALLOCATION_CREATE`, `ALLOCATION_RELEASE`, `ISSUE_POST` for existing effects and use `ALLOCATION_REALLOCATE` for an atomic release+allocate member and `FULFILLMENT_REVERSE_ISSUE` for dedicated Restore. Reallocation claims one root/member per original user event and performs release+allocate under it; it never chains RELEASE and ALLOCATE claims with the same unique source tuple or fabricates another event. Root source.lineId is empty; member source.lineId is claimId. All are persisted module `FULFILLMENT`, with allocation/release documentType `PICK` and Issue/Reverse documentType `SHIPMENT`. A batch source root binds the full normalized payload hash and immutable per-member digest/count. Completed root replay must validate every member receipt. Member compact receipts bind rootOperationId/rootRequestHash/member IDs/old and actual new versions and Movement IDs; immutable Movement snapshots supply bucket fields, while any non-ledger version/identity needed for exact replay remains in that member receipt. Existing8192-byte summary bound is retained; full100-line/5000-allocation JSON is not stored as one root summary. Exact child source/command/completion is checked rather than accepting an opaque operation ID.

The consumer→Sales Reversal intent additionally carries `originalConfirmationEventId` from its locked Shipment. Sales uses the prior completed confirmation journal/source rather than acquiring a new original operation lock after Inventory. Inventory need not receive that cross-owner field.

### HD011 adopted version meanings

Sam adopted A in10_reservation_version_alignment.md. For `CLAIM`, Sales member.expectedVersion is strictly the Sales mapping last-synchronized version obtained from its own projection; it is not asserted to be current Inventory truth. The Inventory command expectedVersion and persisted Fulfillment Claim.inventory_version use a named Inventory owner current-state projection, locked/revalidated with scope/source/status/counters, enforcing total active Claims≤actual native outstanding during Create/Update. Shipment intents use the actual Inventory current CAS; Sales rejects values below last-sync, while its apply verifies the real same-transaction exact owner receipt/current+1 and all native counters against its locked before-state before CAS-syncing mapping from the old last-sync to the actual new version. The earlier same-version shorthand is superseded by these purpose-specific meanings. Only quantity-neutral Allocation/Release/Reallocate CAS increments may defer Sales version synchronization; quantity-changing updates retain atomic provider-result synchronization. A larger version alone never proves neutral intervening changes. All original reserve identity, trigger, exact-set, replay and Reverse checks remain.


## Exact bounded receipt codec (owner implementation contract)

0056 has no status column: a receipt is complete only with non-null `completed_at`, the exact expected `result_type` and bound `result_id`. Root summary is `{memberCount,membershipDigest}`; members are numerically claimId-sorted and digest is SHA256 UTF-8 of newline-joined `claimId:childOperationId:childRequestHash` (no final newline). A member summary contains `{rootOperationId,rootRequestHash,claimId,inventoryReservationId,expectedVersion,version,baseQuantity,fulfillmentLineId,salesOrderLineId,legCount,legDigest}` and for reverse additionally originalInventoryOperationId. IDs/quantities are canonical decimal strings; versions/counts are safe integer Numbers. Completed member result type is the matching `FULFILLMENT_ALLOCATE_MEMBER`, `FULFILLMENT_RELEASE_MEMBER`, `FULFILLMENT_REALLOCATE_MEMBER`, `FULFILLMENT_ISSUE_MEMBER` or `FULFILLMENT_REVERSE_MEMBER`; result_id is its claimId. Root result type is the matching command type and result_id is its documentId.

For arbitrarily distributed bounded5000 allocation legs per old/new set, one separately preclaimed auxiliary operation per leg keeps each summary below8192 bytes. Auxiliary source is module `FULFILLMENT`, documentType `PICK_LEG` or `SHIPMENT_LEG`, same documentId/eventId, lineId `claimId:legOrdinal` (unique within each event; ordinal is1-based within each member, sorted by balanceId for allocate, allocationId for release/reallocate/issue/reverse); command type `FULFILLMENT_BATCH_LEG`. Every auxiliary row is claimed in canonical order with all root/member rows **before** owner stock locks. Its hash binds rootRequestHash, parent claimId, legOrdinal, complete input allocation/balance identity and original movement where applicable; summary stores actual allocationVersion/balanceVersion/movementId, immutable Base UOM identity and any original reference not already immutable in0060. Result type `FULFILLMENT_LEG`, result_id=allocationId. Member legDigest is SHA256 of newline-joined legOrdinal-sorted `legOrdinal:legOperationId:legRequestHash`, without final newline. Each auxiliary receipt binds rootOperationId/rootRequestHash/memberOperationId. Immutable0060 supplies actual movement bucket snapshots; auxiliary facts supply Base UOM and allocationVersion without mutable recomputation. Validate all links, command/result types, completion, counts and both digests on replay. New allocation IDs do not exist before effects; every auxiliary result binds its resulting allocationId and immutable ordinal, while the preclaim hash already binds that ordinal and input balance/quantity. Reallocate independently bounds release and new sets at5000 each (100 lines ×50 allocations), allowing combined10000 auxiliary legs; it uses two disjoint ordinal ranges (release1..oldCount, new oldCount+1..oldCount+newCount, each with the stated canonical ordering). legCount/digest cover the combined full set, and member results distinguish release/new effects. Native full-capacity reallocate must prove this bound, operation-count/transaction budget and rollback without reducing a legal100×50 command. No source collision occurs within one event.

Sales final apply also compares its pre-Inventory intent `inventoryRequestHash` with the actual dedicated root `request_hash`; the full Inventory payload binds all allocation/original-Issue references. Sales verifies its own selected quantities/projection and complete root/member proof without copying Inventory eligibility rules.

## Owner scope guard and mandatory preclaim/consume refinement

The existing one-Fulfillment/one-Sales-Order/one-Warehouse rule is also enforced inside the Inventory owner. Before domain locks, every batch action acquires the stable0056 source `FULFILLMENT/PICK_SCOPE/{fulfillmentId}/""/scope-v1`, command `FULFILLMENT_SCOPE_LOCK`. Its payload is only `{fulfillmentId}`; completed result `FULFILLMENT_SCOPE`, resultId=fulfillmentId, binds immutable `{warehouseId,salesOrderId}` derived from native SALE Reservations and their original Sales operation identities. Mixed or changed scope rejects. Every event for that Fulfillment holds the same operation row until caller commit/rollback, so new Reservation/SKU/Warehouse members cannot race complete-set discovery. This is an operation-class serialization guard, not a new business table, privilege or business event. Generic caller-labelled allocations remain excluded from dedicated owner proof.

The consumer first calls `InventoryFulfillmentService.claimFulfillmentBatchInTransaction(tx,{action,command})` before Sales/Fulfillment/Shipment/master/stock domain locks. Inventory authenticates the real active RC executor and fresh actor, fixes purpose/source, takes the scope guard, and preclaims the complete root/member/auxiliary set. It returns a frozen preparation carrying operationId/requestHash, backed by an owner-private WeakMap. The named post method requires that exact object as its third argument, in the same active transaction with identical action/actor/source/full normalized payload; copied, substituted, closed and foreign proofs fail. Post never fills in missing claims. Concurrent or failed proof execution cannot restart effects; successful sequential replay decodes the original result. Current RC reads of completed immutable operation receipts add no late operation locks. Movement/Reservation postconditions remain owner-verified under the held domain locks.

Issue independently enumerates every positive live dedicated PICK allocation for the entire Fulfillment, derives its verified root line pair, claim and Reservation, and compares the whole exact ID/quantity/bucket set. It repeats the comparison after complete Warehouse anchors; caller-submitted Reservation IDs never limit discovery. The scope guard is acquired by all allocation/release/reallocation/Issue/Reverse entry points. Until all those actual writers, consumer order, full-capacity and native races pass independent review, this refinement is implementation in progress, not Checkpoint0B acceptance.

## Purpose-specific Inventory current-state reads

`InventoryLookupService.lockFulfillmentReservationStatesInTransaction(tx,{warehouseId,salesOrderId,members:[{inventoryReservationId,salesOrderLineId,skuId}]})` is CLAIM-only. It requires real activeRC and fresh view+operation, validates SALE original source/owner/scope and active positive outstanding, locks the complete owner Item policy→Warehouse/Control→Reservation sets, then re-reads native counters/status/version. It returns immutable current-state rows with four canonical quantity strings, native version, original Inventory create operation/event and Sales source identities. Fulfillment Create/Update must enforce active Claim aggregates under its own existing parent/claim locks; this provider does not read or fabricate Fulfillment rows.

`InventoryLookupService.getFulfillmentReversalPreparationInTransaction(tx,{shipmentId,originalInventoryOperationIds})` is a separate preflight read. It requires real activeRC and fresh view+reverse; it accepts the complete original dedicated Issue member set only. It derives the original complete Issue proof and Reservation/Balance identities, checks current native scope/counters and actual versions, and returns advisory JSON:

```js
{fulfillmentId,shipmentId,originalOperationId,lines:[
  {fulfillmentLineId,salesOrderLineId,baseQuantity,reservations:[
    {claimId,inventoryReservationId,baseQuantity,originalInventoryOperationId,expectedVersion,
      currentState:{originalQuantity,consumedQuantity,releasedQuantity,outstandingQuantity,status,version},
      allocations:[{inventoryAllocationId,originalMovementId,baseQuantity,expectedBalanceVersion,bucketSnapshot}]}
  ]}
]}
```

The getter permits CONSUMED/zero outstanding or PARTIALLY_CONSUMED Reservation and historical inactive/archived Item; it does not require fulfillment.operation or current Item usability. It obtains no operation/Movement/Reservation/domain lock and performs no claim/write. Completed immutable Movement reads omit locks only when the DB owner's actual activeRC metadata proves fresh statement reads; default/RR codec behavior retains current Movement locks. The returned object is not the owner-private preparation proof. The consumer adds shipmentIssueId solely from its own original Issue mirror; the genuine write preclaim/consume, full original exact-set, scope/parent locks, current version CAS and unique original-movement reversal all remain mandatory. A race after preflight rejects and rolls back effects; callers never trust a returned larger version as quantity/source evidence.

Completed durable event replay must be resolved from its persisted original operation/command before forcing a new advisory read: after successful Reverse, consumed may already be zero and a fresh preparation correctly refuses another Reverse. An exact retry reuses its original persisted command/outcome and does not invent new current versions or a new event. Getter itself has no event input and is not a replay endpoint. P0 provider/native evidence covers this boundary; P2 consumer execution remains separately gated.
