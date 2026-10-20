import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSalesArchiveEligibility } from "../src/modules/sales/SalesArchiveService.js";

const cutoffMs = Date.UTC(2024, 9, 20, 2);
const valid = () => ({ status: "CLOSED", lastBusinessUpdatedAt: cutoffMs - 1, cutoffMs,
  hasBackorder: false, outstandingReservationCount: 0, inProgressOperationCount: 0,
  fulfillment: { status: "CLOSED", reasonCodes: [] } });

for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
  test(`archive eligibility accepts finalized ${status} only with every observed predicate closed`, () => {
    assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), status }), { eligible: true, reasonCodes: [] });
  });
}
for (const status of ["DRAFT", "CONFIRMING", "CONFIRMED", "PARTIALLY_FULFILLED", "UNKNOWN"]) {
  test(`archive eligibility rejects ${status}`, () => {
    assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), status }), { eligible: false, reasonCodes: ["ORDER_NOT_FINALIZED"] });
  });
}
for (const delta of [0, 1]) {
  test(`archive retention is strict at cutoff plus ${delta} millisecond`, () => {
    assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), lastBusinessUpdatedAt: cutoffMs + delta }),
      { eligible: false, reasonCodes: ["RETENTION_NOT_MET"] });
  });
}
test("archive retention uses last business update and ignores read/export/report timestamps", () => {
  assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), updatedAt: cutoffMs + 1000, lastReadAt: cutoffMs + 2000 }),
    { eligible: true, reasonCodes: [] });
});
for (const [field, value, code] of [["hasBackorder", true, "BACKORDER_OPEN"],
  ["outstandingReservationCount", 1, "RESERVATION_OPEN"], ["inProgressOperationCount", 1, "OPERATION_IN_PROGRESS"]]) {
  test(`archive eligibility rejects ${field}`, () => {
    assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), [field]: value }), { eligible: false, reasonCodes: [code] });
  });
}
test("an observed OPEN Fulfillment blocks archive without returning owner-provided detail", () => {
  assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), fulfillment: { status: "OPEN", reasonCodes: ["private detail"] } }),
    { eligible: false, reasonCodes: ["FULFILLMENT_OPEN"] });
});
for (const fulfillment of [undefined, null, {}, { status: "UNKNOWN" }, { status: "closed" }, "CLOSED",
  { status: "CLOSED" }, { status: "CLOSED", reasonCodes: null }, { status: "CLOSED", reasonCodes: ["contradictory"] }]) {
  test(`missing/unknown/malformed Fulfillment remains ineligible: ${JSON.stringify(fulfillment)}`, () => {
    assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), fulfillment }), { eligible: false, reasonCodes: ["FULFILLMENT_UNKNOWN"] });
  });
}
for (const [field, value] of [["lastBusinessUpdatedAt", undefined], ["lastBusinessUpdatedAt", -1],
  ["lastBusinessUpdatedAt", Number.MAX_SAFE_INTEGER + 1], ["cutoffMs", NaN], ["cutoffMs", 0],
  ["hasBackorder", undefined], ["hasBackorder", "0"], ["outstandingReservationCount", undefined],
  ["outstandingReservationCount", -1], ["outstandingReservationCount", 0.5], ["inProgressOperationCount", "0"]]) {
  test(`invalid ${field} (${String(value)}) fails closed`, () => {
    assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), [field]: value }), { eligible: false, reasonCodes: ["ARCHIVE_FACTS_INVALID"] });
  });
}
test("an unavailable local snapshot fails closed", () => {
  assert.deepEqual(evaluateSalesArchiveEligibility(null), { eligible: false, reasonCodes: ["ARCHIVE_FACTS_INVALID"] });
});
test("all observed open reasons are retained in stable order", () => {
  assert.deepEqual(evaluateSalesArchiveEligibility({ ...valid(), status: "DRAFT", lastBusinessUpdatedAt: cutoffMs,
    hasBackorder: true, outstandingReservationCount: 2, inProgressOperationCount: 1, fulfillment: { status: "OPEN" } }),
    { eligible: false, reasonCodes: ["ORDER_NOT_FINALIZED", "RETENTION_NOT_MET", "BACKORDER_OPEN", "RESERVATION_OPEN", "OPERATION_IN_PROGRESS", "FULFILLMENT_OPEN"] });
});
