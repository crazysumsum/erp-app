import { inventoryError } from "./inventoryErrors.js";

const scopeConflicts = new WeakMap();
const validNumber = value => typeof value === "string" && value.length <= 19 && /^ST-[1-9][0-9]*$/u.test(value) &&
  Number.isSafeInteger(Number(value.slice(3)));

export function stocktakeScopeConflict(number) {
  const error = inventoryError("STOCKTAKE_STATE_CONFLICT");
  if (validNumber(number)) scopeConflicts.set(error, number);
  return error;
}

export async function discloseStocktakeScopeConflict(error, { database, authorize, signal }) {
  const number = scopeConflicts.get(error);
  if (!number) return error;
  try {
    signal?.throwIfAborted();
    await database.withTransaction(async tx => {
      await authorize(tx);
      signal?.throwIfAborted();
    }, { signal });
    signal?.throwIfAborted();
    error.publicDetails = { stocktakeConflict: { kind: "SCOPE_OVERLAP", number } };
  } catch {
    // Optional diagnostics must not replace the original rejection or disclose without current view permission.
  }
  return error;
}
