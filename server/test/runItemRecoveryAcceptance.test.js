import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("item recovery CLI fails closed when the manifest is absent", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "item-recovery-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "report.json");

  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/runItemRecoveryAcceptance.js", "--output", output], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, ITEM_RECOVERY_MANIFEST_PATH: "" }
    }),
    ({ code }) => code === 1
  );

  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
    tests: [{
      name: "Item restored database, media and import reconciliation",
      id: "TC-016",
      status: "FAIL"
    }]
  });
});
