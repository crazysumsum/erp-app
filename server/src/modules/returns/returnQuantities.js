import { returnError } from "./returnErrors.js";

export function assertReturnQuantities(lines, source, alreadyPosted) {
  const submitted = new Map();
  for (const { sourceDetailId, baseQuantity } of lines) {
    submitted.set(sourceDetailId, (submitted.get(sourceDetailId) ?? 0n) + BigInt(baseQuantity));
  }
  for (const [sourceDetailId, quantity] of submitted) {
    const original = source.get(sourceDetailId);
    if (!original || !alreadyPosted.has(sourceDetailId)) throw returnError("RETURN_SOURCE_CONFLICT");
    const total = quantity + BigInt(original.reversed) + BigInt(alreadyPosted.get(sourceDetailId));
    if (total > BigInt(original.quantity)) throw returnError("RETURN_QUANTITY_EXCEEDED", { sourceDetailId });
  }
}
