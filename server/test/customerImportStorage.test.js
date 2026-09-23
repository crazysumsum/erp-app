import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";
import { CustomerImportStorage, customerImportStoredName } from "../src/services/customerImport/CustomerImportStorage.js";

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "customer-import-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const config = normalizeCustomerConfig({ import: { root: path.join(parent, "private"), maxFileBytes: 1024 } }).import;
  return { parent, config, storage: new CustomerImportStorage({ config }) };
}

test("Customer import storage stages and atomically finalizes a hash-bound private source", async (t) => {
  const { config, storage } = await fixture(t);
  const operationId = randomUUID(); const content = Buffer.from("customerCode,legalName\r\nC-1,Acme\r\n");
  const metadata = await storage.stageSource({ operationId, content });
  assert.deepEqual(await storage.stageSource({ operationId, content }), metadata);
  assert.equal(metadata.storedName, customerImportStoredName(operationId));
  await storage.finalizeSource(metadata);
  await storage.finalizeSource(metadata);
  assert.deepEqual(await storage.readSource(metadata), content);
  const chunks = [];
  for await (const chunk of await storage.streamSource(metadata)) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), content);
  assert.equal((await lstat(path.join(config.root, "source", metadata.storedName))).mode & 0o777, 0o600);
  assert.equal((await lstat(config.root)).mode & 0o777, 0o700);
});

test("Customer import storage enforces expected hashes and idempotent staged cleanup", async (t) => {
  const { storage } = await fixture(t);
  const operationId = randomUUID(); const content = Buffer.from("a,b\r\n1,2\r\n");
  await assert.rejects(
    () => storage.stageSource({ operationId, content, expectedSha256: "00".repeat(32) }),
    /hash mismatch/u
  );
  const metadata = await storage.stageSource({ operationId, content });
  await storage.discardStaged(metadata.storedName);
  await storage.discardStaged(metadata.storedName);
});

test("Customer import storage rejects tamper, traversal names and symlink roots", async (t) => {
  const { parent, config, storage } = await fixture(t);
  const metadata = await storage.stageSource({ operationId: randomUUID(), content: Buffer.from("a,b\r\n1,2\r\n") });
  await storage.finalizeSource(metadata);
  await writeFile(path.join(config.root, "source", metadata.storedName), "tampered");
  await assert.rejects(() => storage.readSource(metadata), /integrity/u);
  await assert.rejects(() => storage.readSource({ storedName: "../outside", sha256: metadata.sha256 }), /stored name/u);

  const target = path.join(parent, "target");
  await rm(config.root, { recursive: true, force: true });
  await mkdir(target);
  await symlink(target, config.root);
  const symlinked = new CustomerImportStorage({ config });
  await assert.rejects(() => symlinked.stageSource({ operationId: randomUUID(), content: Buffer.from("x") }), /regular directory/u);
});

test("Customer import config bounds import capacity and keeps roots separate", () => {
  assert.throws(() => normalizeCustomerConfig({ import: { root: "relative" } }), /absolute path/u);
  assert.throws(() => normalizeCustomerConfig({ import: { root: "/tmp/customer", maxRows: 10001 } }), /import\.maxRows/u);
  assert.throws(() => normalizeCustomerConfig({
    bankEncryption: { activeKeyId: "enc", keyRing: { enc: Buffer.alloc(32, 1).toString("base64") } },
    bankLookup: { activeKeyId: "lookup", keyRing: { lookup: Buffer.alloc(32, 2).toString("base64") } },
    attachment: {
      generalRoot: "/tmp/customer/general", bankSensitiveRoot: "/tmp/customer/bank", tempRoot: "/tmp/customer/temp",
      malwareScanner: { mode: "clamd", host: "127.0.0.1" }
    },
    import: { root: "/tmp/customer/general/imports" }
  }), /non-overlapping/u);
});
