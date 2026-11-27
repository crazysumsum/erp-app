// Inventory costs stay in ten-thousandths of HKD from parsing through persistence.
const MAX_COST = 10n ** 19n - 1n;
const MAX_POOL_QUANTITY = 2n ** 64n - 1n;
const MAX_ENTRY_QUANTITY = 2n ** 63n - 1n;

function bounded(value, minimum, maximum, field) {
  if (typeof value !== "bigint" || value < minimum || value > maximum) {
    throw new RangeError(`Inventory cost ${field} is outside its storage range`);
  }
  return value;
}

export function parseInventoryCost(text) {
  if (typeof text !== "string" || !/^-?\d{1,15}(?:\.\d{1,4})?$/u.test(text)) {
    throw new RangeError("Inventory cost must be a DECIMAL(19,4) string");
  }
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const units = BigInt(whole + fraction.padEnd(4, "0"));
  return negative ? -units : units;
}

export function formatInventoryCost(value) {
  bounded(value, -MAX_COST, MAX_COST, "amount");
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(5, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

function roundHalfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

export function receiptCost(baseQuantity, unitPrice, toBaseFactor) {
  bounded(baseQuantity, 1n, MAX_ENTRY_QUANTITY, "quantity");
  bounded(unitPrice, 0n, MAX_COST, "unit price");
  bounded(toBaseFactor, 1n, 1000000n, "purchase unit factor");
  return bounded(roundHalfUp(baseQuantity * unitPrice, toBaseFactor), 0n, MAX_COST, "receipt amount");
}

export function originalCostShare(originalValue, originalQuantity, previouslyReturned, quantity) {
  bounded(originalValue, 0n, MAX_COST, "original amount");
  bounded(originalQuantity, 1n, MAX_ENTRY_QUANTITY, "original quantity");
  bounded(previouslyReturned, 0n, originalQuantity, "prior returned quantity");
  bounded(quantity, 1n, originalQuantity - previouslyReturned, "returned quantity");
  const before = roundHalfUp(originalValue * previouslyReturned, originalQuantity);
  const after = roundHalfUp(originalValue * (previouslyReturned + quantity), originalQuantity);
  return after - before;
}

function validatePool(pool) {
  bounded(pool.quantity, 0n, MAX_POOL_QUANTITY, "pool quantity");
  bounded(pool.value, 0n, pool.quantity === 0n ? 0n : MAX_COST, "pool amount");
}

export function inboundCost(pool, quantity, value) {
  validatePool(pool);
  bounded(quantity, 1n, MAX_ENTRY_QUANTITY, "quantity");
  bounded(value, 0n, MAX_COST, "amount");
  return {
    quantity: bounded(pool.quantity + quantity, 1n, MAX_POOL_QUANTITY, "pool quantity"),
    value: bounded(pool.value + value, 0n, MAX_COST, "pool amount"),
    quantityDelta: quantity,
    valueDelta: value
  };
}

export function outboundCost(pool, quantity, originalShare) {
  validatePool(pool);
  bounded(quantity, 1n, MAX_ENTRY_QUANTITY, "quantity");
  bounded(quantity, 1n, pool.quantity, "outbound quantity");
  if (originalShare !== undefined) bounded(originalShare, 0n, MAX_COST, "original share");
  const allocated = originalShare === undefined
    ? roundHalfUp(pool.value * quantity, pool.quantity)
    : originalShare;
  const value = quantity === pool.quantity || allocated > pool.value ? pool.value : allocated;
  return {
    quantity: pool.quantity - quantity, value: pool.value - value,
    quantityDelta: -quantity, valueDelta: -value
  };
}
