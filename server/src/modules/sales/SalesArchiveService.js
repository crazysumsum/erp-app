const FINALIZED_STATUSES = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

export function evaluateSalesArchiveEligibility(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)
    || !Number.isSafeInteger(facts.lastBusinessUpdatedAt) || facts.lastBusinessUpdatedAt < 0
    || !Number.isSafeInteger(facts.cutoffMs) || facts.cutoffMs <= 0
    || typeof facts.hasBackorder !== "boolean"
    || !Number.isSafeInteger(facts.outstandingReservationCount) || facts.outstandingReservationCount < 0
    || !Number.isSafeInteger(facts.inProgressOperationCount) || facts.inProgressOperationCount < 0) {
    return { eligible: false, reasonCodes: ["ARCHIVE_FACTS_INVALID"] };
  }
  const reasonCodes = [];
  if (!FINALIZED_STATUSES.has(facts.status)) reasonCodes.push("ORDER_NOT_FINALIZED");
  if (facts.lastBusinessUpdatedAt >= facts.cutoffMs) reasonCodes.push("RETENTION_NOT_MET");
  if (facts.hasBackorder) reasonCodes.push("BACKORDER_OPEN");
  if (facts.outstandingReservationCount > 0) reasonCodes.push("RESERVATION_OPEN");
  if (facts.inProgressOperationCount > 0) reasonCodes.push("OPERATION_IN_PROGRESS");
  if (facts.fulfillment?.status === "OPEN") reasonCodes.push("FULFILLMENT_OPEN");
  else if (facts.fulfillment?.status !== "CLOSED" || !Array.isArray(facts.fulfillment.reasonCodes)
    || facts.fulfillment.reasonCodes.length !== 0) reasonCodes.push("FULFILLMENT_UNKNOWN");
  return { eligible: reasonCodes.length === 0, reasonCodes };
}
