import assert from "node:assert/strict";
import test from "node:test";

import {
  INVENTORY_FAILURE_POINTS,
  createFakeInventoryDatabase,
  createInventoryBarrier
} from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

test("fake Inventory transactions can fail at every required boundary without committing state", async () => {
  for (const failurePoint of INVENTORY_FAILURE_POINTS) {
    const database = createFakeInventoryDatabase({
      initialState: { effects: [] },
      failAt: failurePoint
    });

    await assert.rejects(
      () => database.withTransaction(async (transaction) => {
        for (const point of INVENTORY_FAILURE_POINTS.filter((value) => value !== "commit")) {
          transaction.state.effects.push(point);
          transaction.checkpoint(point);
        }
      }),
      (error) => error.faultPoint === failurePoint
    );
    assert.deepEqual(database.state, { effects: [] });
  }

  const database = createFakeInventoryDatabase({ initialState: { effects: [] } });
  await database.withTransaction(async (transaction) => {
    transaction.state.effects.push("committed");
  });
  assert.deepEqual(database.state, { effects: ["committed"] });
});

test("Inventory barrier releases two independently-started connection flows together", async () => {
  const barrier = createInventoryBarrier(2);
  let firstReleased = false;
  const first = barrier.wait().then(() => { firstReleased = true; });

  await Promise.resolve();
  assert.equal(firstReleased, false);
  const second = barrier.wait();
  await Promise.all([first, second]);
  assert.equal(firstReleased, true);
  await assert.rejects(() => barrier.wait(), /already released/);
});

test("Inventory command fixtures are valid independent values", () => {
  const first = inventoryCommandFixture();
  const second = inventoryCommandFixture({ payload: { skuId: 99 } });

  first.actor.claimedPermissions.push("inventory.adjust");
  assert.deepEqual(second.payload, { skuId: 99 });
  assert.deepEqual(second.actor.claimedPermissions, ["receiving.operation"]);
});
