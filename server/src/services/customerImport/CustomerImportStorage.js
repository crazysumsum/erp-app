import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function framed(parts) {
  return Buffer.from(parts.map((part) => { const value = String(part); return `${Buffer.byteLength(value, "utf8")}:${value}`; }).join(""), "utf8");
}

export function customerImportStoredName(operationId, kind = "source") {
  const id = String(operationId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id) || !["source", "result"].includes(kind)) {
    throw new TypeError("Customer import operation or object kind is invalid");
  }
  return createHash("sha256").update(framed(["customer-import:v1", id, kind])).digest("hex");
}

function safeName(value) {
  const name = String(value ?? "");
  if (!/^[0-9a-f]{64}$/u.test(name)) throw new TypeError("Customer import stored name is invalid");
  return name;
}

async function regularFile(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Customer import object is not a regular file");
  return info;
}

export class CustomerImportStorage {
  constructor({ config } = {}) {
    if (!config?.root || !config.maxFileBytes) throw new TypeError("CustomerImportStorage requires config");
    this.config = config; this.ready = null;
  }

  async #ensureRoot() {
    if (!this.ready) this.ready = (async () => {
      await mkdir(this.config.root, { recursive: true, mode: 0o700 });
      const info = await lstat(this.config.root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Customer import root is not a regular directory");
      await chmod(this.config.root, 0o700);
      for (const child of [".staging", "source", "result"]) {
        const directory = path.join(this.config.root, child);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const childInfo = await lstat(directory);
        if (!childInfo.isDirectory() || childInfo.isSymbolicLink() || childInfo.dev !== info.dev) {
          throw new Error("Customer import storage must use regular directories on one filesystem");
        }
        await chmod(directory, 0o700);
      }
    })();
    return this.ready;
  }

  #path(kind, storedName) { return path.join(this.config.root, kind, safeName(storedName)); }
  #staging(storedName) { return path.join(this.config.root, ".staging", safeName(storedName)); }

  async stageSource({ operationId, content, expectedSha256 }) {
    await this.#ensureRoot();
    if (!Buffer.isBuffer(content) || content.length < 1 || content.length > this.config.maxFileBytes) {
      throw new Error("Customer import source size is invalid");
    }
    const sha256 = createHash("sha256").update(content).digest();
    if (expectedSha256 && !sha256.equals(Buffer.from(expectedSha256, "hex"))) throw new Error("Customer import source hash mismatch");
    const storedName = customerImportStoredName(operationId, "source");
    const staged = this.#staging(storedName);
    try { await writeFile(staged, content, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(staged);
      if (!createHash("sha256").update(existing).digest().equals(sha256)) throw new Error("Customer import staged object hash mismatch");
    }
    return { storedName, sha256 };
  }

  async finalizeSource(metadata) {
    return this.#finalize("source", metadata);
  }

  async #finalize(kind, metadata) {
    await this.#ensureRoot();
    const target = this.#path(kind, metadata.storedName);
    try {
      await regularFile(target);
      const existing = await readFile(target);
      if (!createHash("sha256").update(existing).digest().equals(Buffer.from(metadata.sha256))) throw new Error(`Customer import ${kind} integrity check failed`);
      await unlink(this.#staging(metadata.storedName)).catch((stagingError) => { if (stagingError.code !== "ENOENT") throw stagingError; });
      return;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await rename(this.#staging(metadata.storedName), target);
    await chmod(target, 0o600);
    await this.#read(kind, metadata);
  }

  async readSource(metadata) {
    return this.#read("source", metadata);
  }

  async #read(kind, metadata) {
    await this.#ensureRoot();
    const target = this.#path(kind, metadata.storedName);
    await regularFile(target);
    const content = await readFile(target);
    if (!createHash("sha256").update(content).digest().equals(Buffer.from(metadata.sha256))) throw new Error(`Customer import ${kind} integrity check failed`);
    return content;
  }

  async streamSource(metadata) {
    await this.#ensureRoot();
    const target = this.#path("source", metadata.storedName);
    await regularFile(target);
    const expected = Buffer.from(metadata.sha256);
    async function* verifiedStream() {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(target)) { hash.update(chunk); yield chunk; }
      if (!hash.digest().equals(expected)) throw new Error("Customer import source integrity check failed");
    }
    return verifiedStream();
  }

  async discardStaged(storedName) {
    await this.#ensureRoot();
    try { await regularFile(this.#staging(storedName)); await unlink(this.#staging(storedName)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  async stageResult({ operationId, source }) {
    await this.#ensureRoot();
    const storedName = customerImportStoredName(operationId, "result");
    const staged = this.#staging(storedName);
    let handle;
    try {
      handle = await open(staged, "wx", 0o600);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(staged);
      const expected = createHash("sha256"); let sizeBytes = 0;
      for await (const value of source) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
        sizeBytes += chunk.length; expected.update(chunk);
        if (sizeBytes > this.config.maxFileBytes) throw new Error("Customer import result size is invalid");
      }
      const sha256 = createHash("sha256").update(existing).digest();
      if (sizeBytes !== existing.length || !expected.digest().equals(sha256)) throw new Error("Customer import staged result integrity check failed");
      return { storedName, sha256, sizeBytes };
    }
    const hash = createHash("sha256");
    let sizeBytes = 0;
    try {
      for await (const value of source) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
        sizeBytes += chunk.length;
        if (sizeBytes > this.config.maxFileBytes) throw new Error("Customer import result size is invalid");
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.close(); handle = null;
      return { storedName, sha256: hash.digest(), sizeBytes };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(staged).catch(() => {});
      throw error;
    }
  }

  async finalizeResult(metadata) { return this.#finalize("result", metadata); }

  async readResult(metadata) { return this.#read("result", metadata); }
}
