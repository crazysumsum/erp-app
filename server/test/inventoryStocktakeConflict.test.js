import assert from "node:assert/strict";
import test from "node:test";
import { stocktakeScopeConflict, discloseStocktakeScopeConflict } from "../src/modules/inventory/inventoryStocktakeConflict.js";

for (const kind of ["authorized", "unregistered", "invalid number", "authorization rejected", "aborted before", "aborted after transaction", "transaction rejected"]) {
  test(`DEF012 server ${kind} retains the original error and discloses only after current authorization`, async () => {
    const error = kind === "unregistered"
      ? Object.assign(new Error("Original rejection"), { code: "STOCKTAKE_STATE_CONFLICT" })
      : stocktakeScopeConflict(kind === "invalid number" ? "ST-0" : "ST-21");
    const controller = new AbortController(), tx = {}, events = [];
    const failure = new Error("Synthetic authorization or transaction failure");
    if (kind === "aborted before") controller.abort(failure);
    const database = { withTransaction: async (callback, options) => {
      assert.equal(options.signal, controller.signal);
      events.push("begin");
      await callback(tx);
      events.push("authorized");
      if (kind === "transaction rejected") throw failure;
      events.push("complete");
      if (kind === "aborted after transaction") controller.abort(failure);
    } };
    const authorize = async executor => {
      assert.equal(executor, tx); events.push("authorize");
      assert.equal(Object.hasOwn(error, "publicDetails"), false);
      if (kind === "authorization rejected") throw failure;
    };
    const result = await discloseStocktakeScopeConflict(error, { database, authorize, signal: controller.signal });
    assert.equal(result, error);
    assert.equal(result.code, "STOCKTAKE_STATE_CONFLICT");
    if (kind === "authorized") {
      assert.deepEqual(events, ["begin", "authorize", "authorized", "complete"]);
      assert.deepEqual(result.publicDetails, { stocktakeConflict: { kind: "SCOPE_OVERLAP", number: "ST-21" } });
    } else {
      assert.equal(Object.hasOwn(result, "publicDetails"), false);
      const expected = ["unregistered", "invalid number", "aborted before"].includes(kind) ? []
        : kind === "authorization rejected" ? ["begin", "authorize"]
          : kind === "transaction rejected" ? ["begin", "authorize", "authorized"]
            : ["begin", "authorize", "authorized", "complete"];
      assert.deepEqual(events, expected);
    }
  });
}
