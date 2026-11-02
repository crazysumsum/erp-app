import process from "node:process";
import { pathToFileURL } from "node:url";

// Existing cases only. Exact names keep ordinary cases in these same files in coverage.
export const cases = [
  ["fulfillmentQueueCapacity", "P1 Queue returns 100 SKU lines backed by 5000 native Reservations within the original two-second inquiry budget"],
  ["fulfillmentDraftCapacity", "Maximum100-line/5000-member Create and Update retain all Claims and roll back the last failed Claim batch"],
  ["fulfillmentCandidates", "HD018 100-line/5000-Claim advisory shares each SKU budget without changing owner quantities"],
  ["fulfillmentAllocationApi", "P1 full Allocate 100-line/5000-Reservation capacity retains the original20-second transaction limit"],
  ["fulfillmentReallocationApi", "P1 full5000-member Reallocate retains20s and restores the final projection batch before same-event recovery"],
  ["fulfillmentPickingApi", "P1 full5000-member Pick retains20s, releases4999 Short members and restores final projection and audit batches before recovery"],
  ["fulfillmentCancellationCapacity", "P1 Cancel5000 picked Allocations retains20s and every picked fact through final projection, Claim and audit rollback"],
  ["fulfillmentCancellationCapacity", "P1 DRAFT Cancel5000 Claims preserves20s and no Inventory DML through final Claim rollback and recovery"],
  ["fulfillmentHttpCapacity", "Full5000 actualHTTP Allocate/Reallocate/Pick retain20s, strict permissions, late rollback and exact replay"],
  ["fulfillmentPrintCapacity", "Pick List retains all100lines/5000current Allocations within original3s preview budget and20s transactions"],
  ...[100, 5000].flatMap(balances => [
    ["fulfillmentReallocationCandidateCapacity", `HD020 full100lines/5000members over ${balances} balances share all own credits with zeroDML and unchanged20s`],
    ["fulfillmentAllocationPreviewCapacity", `HD024 full100lines/5000members over ${balances} balances preview actual selections and all own credits with zeroDML and unchanged20s`]
  ])
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  throw new Error("Capacity execution moved to capacity-runner.mjs; a verified CAPACITY_SELECTION is required");
}
