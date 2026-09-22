import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("Customer bank maintenance CLI fails before database access when shared bank key rings differ", () => {
  const customerKey = Buffer.alloc(32, 1).toString("base64");
  const supplierKey = Buffer.alloc(32, 2).toString("base64");
  const lookupKey = Buffer.alloc(32, 3).toString("base64");
  const result = spawnSync(process.execPath, ["scripts/rotateCustomerBankEncryption.js", "--reason", "security regression"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8",
    env: {
      ...process.env,
      CUSTOMER_BANK_ACTIVE_KEY_ID: "enc", CUSTOMER_BANK_ENCRYPTION_KEYS: JSON.stringify({ enc: customerKey }),
      CUSTOMER_BANK_LOOKUP_ACTIVE_KEY_ID: "lookup", CUSTOMER_BANK_LOOKUP_KEYS: JSON.stringify({ lookup: lookupKey }),
      SUPPLIER_BANK_ACTIVE_KEY_ID: "enc", SUPPLIER_BANK_ENCRYPTION_KEYS: JSON.stringify({ enc: supplierKey }),
      SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID: "lookup", SUPPLIER_BANK_LOOKUP_KEYS: JSON.stringify({ lookup: lookupKey })
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use the same key rings/u);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|Access denied/u);
});
