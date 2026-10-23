export const FULFILLMENT_INVENTORY_COMMANDS = Object.freeze({
  ALLOCATE: Object.freeze({ root:"FULFILLMENT_BATCH_ALLOCATE", member:"ALLOCATION_CREATE", result:"FULFILLMENT_ALLOCATE_MEMBER", documentType:"PICK" }),
  RELEASE: Object.freeze({ root:"FULFILLMENT_BATCH_RELEASE", member:"ALLOCATION_RELEASE", result:"FULFILLMENT_RELEASE_MEMBER", documentType:"PICK" }),
  REALLOCATE: Object.freeze({ root:"FULFILLMENT_BATCH_REALLOCATE", member:"ALLOCATION_REALLOCATE", result:"FULFILLMENT_REALLOCATE_MEMBER", documentType:"PICK" }),
  ISSUE: Object.freeze({ root:"FULFILLMENT_BATCH_ISSUE", member:"ISSUE_POST", result:"FULFILLMENT_ISSUE_MEMBER", documentType:"SHIPMENT" }),
  REVERSE: Object.freeze({ root:"FULFILLMENT_BATCH_REVERSE", member:"FULFILLMENT_REVERSE_ISSUE", result:"FULFILLMENT_REVERSE_MEMBER", documentType:"SHIPMENT" })
});
export const FULFILLMENT_INVENTORY_SUMMARY_FIELDS = Object.freeze([
  "memberCount", "claimId", "inventoryReservationId", "fulfillmentId", "fulfillmentLineId", "salesOrderLineId",
  "legCount", "legDigest", "memberOperationId", "legOrdinal", "allocationVersion", "originalInventoryOperationId",
  "originalMovementId", "shipmentIssueId", "inventoryAllocationId", "inventoryBalanceId", "lineSnapshot", "legKind",
  "selectionStrategy", "isSequenceOverride", "recommendedRank", "salesOrderId", "bucketSnapshot", "recommendedSummary"
]);
