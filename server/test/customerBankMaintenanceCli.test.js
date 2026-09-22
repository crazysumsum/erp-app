import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../scripts/rotateCustomerBankEncryption.js";

test("Customer bank maintenance CLI requires a bounded batch and an explicit reason", () => {
  assert.deepEqual(
    parseArguments(["--after-id", "41", "--batch-size", "25", "--reason", "quarterly key rotation"]),
    { afterId: 41, batchSize: 25, reason: "quarterly key rotation" }
  );
  assert.throws(() => parseArguments(["--reason", ""]), /Usage:/u);
  assert.throws(() => parseArguments(["--batch-size", "1001", "--reason", "rotation"]), /batch-size/u);
});
