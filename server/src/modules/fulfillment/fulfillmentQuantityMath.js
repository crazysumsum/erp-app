import { FULFILLMENT_STATUSES } from "./fulfillmentConstants.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";

function requireQuantity(condition) {
  if (!condition) throw fulfillmentError("FULFILLMENT_QUANTITY_INVALID");
}

export function assertFulfillmentQuantities(status, lines) {
  requireQuantity(FULFILLMENT_STATUSES.includes(status) && Array.isArray(lines) && lines.length > 0);
  let totalPicked = 0n;
  let cancelledDraft = true, cancelledPicking = true, cancelledPicked = true;
  for (const line of lines) {
    const planned = fulfillmentInteger(line?.planned);
    const [allocated, released, picked, short, shipped, reversed] =
      ["allocated", "released", "picked", "short", "shipped", "reversed"]
        .map(name => fulfillmentInteger(line?.[name], { positive: false }));
    requireQuantity(released <= allocated && picked <= planned && short <= planned);
    if (status === "DRAFT") requireQuantity(allocated === 0n && released === 0n && picked === 0n && short === 0n && shipped === 0n && reversed === 0n);
    if (status === "PICKING") requireQuantity(allocated - released === planned && picked === 0n && short === 0n && shipped === 0n && reversed === 0n);
    if (["PICKED", "SHIPPED", "REVERSED"].includes(status)) {
      requireQuantity(allocated >= planned && planned === picked + short && allocated === picked + released);
      requireQuantity(shipped === (status === "PICKED" ? 0n : picked));
      requireQuantity(reversed === (status === "REVERSED" ? shipped : 0n));
    }
    if (status === "CANCELLED") {
      requireQuantity(allocated === released && shipped === 0n && reversed === 0n);
      cancelledDraft &&= allocated === 0n && picked === 0n && short === 0n;
      cancelledPicking &&= allocated >= planned && picked === 0n && short === 0n;
      cancelledPicked &&= allocated >= planned && planned === picked + short;
    }
    totalPicked += picked;
  }
  if (["PICKED", "SHIPPED", "REVERSED"].includes(status)) requireQuantity(totalPicked > 0n);
  if (status === "CANCELLED") requireQuantity(cancelledDraft || cancelledPicking || (cancelledPicked && totalPicked > 0n));
  return true;
}

export function assertClaimQuantities(claim) {
  const original = fulfillmentInteger(claim?.original);
  const [active, released, consumed, reversed] = ["active", "released", "consumed", "reversed"]
    .map(name => fulfillmentInteger(claim?.[name], { positive: false }));
  requireQuantity(original === active + released + consumed && reversed <= consumed);
  return true;
}
