import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeCustomerConfig } from "../src/modules/customer/normalizeCustomerConfig.js";
import { CustomerAttachmentStorage } from "../src/services/customerFile/CustomerAttachmentStorage.js";
import { FileTypeService } from "../src/services/filetype/FileTypeService.js";

const PDF = Buffer.from("%PDF-1.7\ncustomer attachment secret\n%%EOF\n", "utf8");

async function fixture(t, { scan = "clean" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "customer-attachment-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = {
    bankEncryption: { activeKeyId: "enc", keyRing: { enc: randomBytes(32).toString("base64") } },
    bankLookup: { activeKeyId: "lookup", keyRing: { lookup: randomBytes(32).toString("base64") } },
    attachment: {
      generalRoot: path.join(root, "general"), bankSensitiveRoot: path.join(root, "bank"), tempRoot: path.join(root, "temp"),
      maxFileBytes: 1024, orphanGraceMs: 2000,
      malwareScanner: { mode: "clamd", host: "127.0.0.1", port: 3310, timeoutMs: 1000 }
    }
  };
  const config = normalizeCustomerConfig(source);
  const storage = new CustomerAttachmentStorage({
    config: config.attachment, encryption: config.bankEncryption,
    scanner: { async scan() { return { status: scan }; } }, fileTypes: new FileTypeService()
  });
  return { root, config, storage };
}

test("Customer attachment storage validates, scans, encrypts and finalizes without plaintext on disk", async (t) => {
  const { root, storage } = await fixture(t);
  const metadata = await storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "bank_sensitive", content: PDF, mimeType: "application/pdf", originalFilename: "bank-proof.pdf" });
  const staged = await readFile(path.join(root, "temp", metadata.storedName.slice(0, 2), metadata.storedName));
  assert.equal(staged.includes(PDF), false);
  await storage.finalize(metadata);
  assert.deepEqual(await storage.read(metadata), PDF);
  assert.equal((await lstat(path.join(root, "bank", metadata.storedName))).mode & 0o777, 0o600);
});

test("Customer attachment storage rejects unsafe types and failed scans before writing", async (t) => {
  const { root, storage } = await fixture(t, { scan: "infected" });
  await assert.rejects(
    () => storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "general", content: PDF, mimeType: "application/pdf", originalFilename: "document.pdf" }),
    /scan did not return clean/u
  );
  await assert.rejects(
    () => storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "general", content: Buffer.concat([PDF, Buffer.from("PK\x03\x04polyglot")]), mimeType: "application/pdf", originalFilename: "polyglot.pdf" }),
    /file type is invalid/u
  );
  await assert.rejects(
    () => storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "general", content: Buffer.from("<svg><script/></svg>"), mimeType: "image/svg+xml", originalFilename: "x.svg" }),
    /file type is invalid/u
  );
  assert.deepEqual(await readdir(path.join(root, "temp")), []);
});

test("Customer attachment storage idempotently deletes its controlled temp object", async (t) => {
  const { root, storage } = await fixture(t);
  const value = await storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "general", content: PDF, mimeType: "application/pdf", originalFilename: "contract.pdf" });
  await storage.discardTemp(value);
  assert.deepEqual(await readdir(path.join(root, "temp", value.storedName.slice(0, 2))), []);
  await storage.discardTemp(value);
});

test("Customer attachment recovery finalizes a valid temp object and rejects tamper or symlink", async (t) => {
  const { root, storage } = await fixture(t);
  const metadata = await storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "general", content: PDF, mimeType: "application/pdf", originalFilename: "contract.pdf" });
  assert.equal(await storage.recover(metadata), "active");
  const target = path.join(root, "general", metadata.storedName);
  const encrypted = await readFile(target); encrypted[encrypted.length - 1] ^= 1; await writeFile(target, encrypted);
  assert.equal(await storage.recover(metadata), "storage_error");

  const symlinkMetadata = { ...metadata, storedName: "a".repeat(64) };
  await symlink(target, path.join(root, "general", symlinkMetadata.storedName));
  await assert.rejects(() => storage.read(symlinkMetadata), /regular file/u);
});

test("Customer attachment storage rejects a symlinked configured root", async (t) => {
  const { root, config } = await fixture(t);
  const target = path.join(root, "target");
  await mkdir(target);
  await symlink(target, config.attachment.generalRoot);
  const storage = new CustomerAttachmentStorage({
    config: config.attachment, encryption: config.bankEncryption,
    scanner: { async scan() { return { status: "clean" }; } }, fileTypes: new FileTypeService()
  });
  await assert.rejects(
    () => storage.stage({ operationId: randomUUID(), customerId: 7, sensitivity: "general", content: PDF, mimeType: "application/pdf", originalFilename: "contract.pdf" }),
    /regular directory/u
  );
});
