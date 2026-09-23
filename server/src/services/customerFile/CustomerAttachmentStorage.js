import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { revealSecret } from "../../framework/configuration/SecretValue.js";

const MAGIC = Buffer.from("CUSTATT1", "ascii");
const MIME_EXTENSIONS = Object.freeze({
  "application/pdf": [".pdf"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"]
});
const PNG_END = Buffer.from("0000000049454e44ae426082", "hex");

function rejected(message) {
  return Object.assign(new Error(message), { code: "CUSTOMER_ATTACHMENT_REJECTED" });
}

function framed(parts) {
  return Buffer.from(parts.map((part) => { const value = String(part); return `${Buffer.byteLength(value, "utf8")}:${value}`; }).join(""), "utf8");
}

function storedName(operationId) {
  const id = String(operationId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new TypeError("Customer attachment operationId is invalid");
  }
  return createHash("sha256").update(framed(["customer-attachment:v1", id])).digest("hex");
}

function validStoredName(value) {
  const name = String(value ?? "");
  if (!/^[0-9a-f]{64}$/u.test(name)) throw new TypeError("Customer attachment stored name is invalid");
  return name;
}

function tempPath(root, name) {
  return path.join(root, name.slice(0, 2), name);
}

function aad(metadata) {
  return framed(["erp-customer-attachment:v1", metadata.customerId, metadata.operationId, metadata.storedName, metadata.sensitivity]);
}

function objectHeader(value) {
  if (value.length < MAGIC.length + 1 + 36 + 12 + 16 || !value.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Customer attachment object format is invalid");
  }
  const keyLength = value[MAGIC.length];
  const keyStart = MAGIC.length + 1;
  const operationStart = keyStart + keyLength;
  const ivStart = operationStart + 36;
  const tagStart = ivStart + 12;
  const bodyStart = tagStart + 16;
  const operationId = value.subarray(operationStart, ivStart).toString("ascii");
  if (keyLength < 1 || bodyStart > value.length || !/^[0-9a-f-]{36}$/u.test(operationId)) {
    throw new Error("Customer attachment object format is invalid");
  }
  return { keyStart, operationStart, ivStart, tagStart, bodyStart, operationId };
}

function extension(mimeType, originalFilename) {
  const allowed = MIME_EXTENSIONS[mimeType] ?? [];
  const found = path.extname(path.basename(String(originalFilename ?? ""))).toLowerCase();
  if (!allowed.includes(found)) throw new Error("Customer attachment extension does not match its content type");
  return found.slice(1);
}

function hasSafeBoundary(mimeType, content) {
  if (mimeType === "application/pdf") {
    let end = content.length;
    while (end > 0 && [9, 10, 12, 13, 32].includes(content[end - 1])) end -= 1;
    return end >= 5 && content.subarray(end - 5, end).toString("ascii") === "%%EOF";
  }
  if (mimeType === "image/png") return content.length >= PNG_END.length && content.subarray(-PNG_END.length).equals(PNG_END);
  if (mimeType === "image/jpeg") return content.length >= 2 && content.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
  if (mimeType === "image/webp") return content.length >= 12 && content.readUInt32LE(4) + 8 === content.length;
  return false;
}

export class CustomerAttachmentStorage {
  constructor({ config, encryption, scanner, fileTypes } = {}) {
    if (!config || !encryption?.activeKeyId || !scanner || !fileTypes) {
      throw new TypeError("CustomerAttachmentStorage requires config, encryption, scanner and fileTypes");
    }
    this.config = config;
    this.encryption = encryption;
    this.scanner = scanner;
    this.fileTypes = fileTypes;
    this.ready = null;
  }

  async #ensureRoots() {
    if (!this.ready) this.ready = Promise.all([this.config.generalRoot, this.config.bankSensitiveRoot, this.config.tempRoot]
      .map(async (root) => {
        await mkdir(root, { recursive: true, mode: 0o700 });
        const info = await lstat(root);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Customer attachment root is not a regular directory");
        await chmod(root, 0o700);
        return info;
      }))
      .then(([general, sensitive, temp]) => {
        if (general.dev !== temp.dev || sensitive.dev !== temp.dev) {
          throw new Error("Customer attachment temp and final roots must support atomic rename on the same filesystem");
        }
      });
    return this.ready;
  }

  #root(sensitivity) {
    if (sensitivity === "general") return this.config.generalRoot;
    if (sensitivity === "bank_sensitive") return this.config.bankSensitiveRoot;
    throw new TypeError("Customer attachment sensitivity is invalid");
  }

  #key(keyId) {
    const value = this.encryption.keyRing[String(keyId ?? "")];
    if (!value) throw new Error("Customer attachment encryption key is unavailable");
    return Buffer.from(revealSecret(value), "base64");
  }

  #encrypt(content, metadata) {
    const keyId = this.encryption.activeKeyId;
    const keyIdBytes = Buffer.from(keyId, "ascii");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key(keyId), iv);
    cipher.setAAD(aad(metadata));
    const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
    return Buffer.concat([MAGIC, Buffer.from([keyIdBytes.length]), keyIdBytes, Buffer.from(metadata.operationId, "ascii"), iv, cipher.getAuthTag(), ciphertext]);
  }

  #decrypt(value, metadata) {
    const { keyStart, operationStart, ivStart, tagStart, bodyStart, operationId } = objectHeader(value);
    if (operationId !== metadata.operationId || storedName(operationId) !== metadata.storedName) {
      throw new Error("Customer attachment object operation binding is invalid");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.#key(value.subarray(keyStart, operationStart).toString("ascii")), value.subarray(ivStart, tagStart));
    decipher.setAAD(aad(metadata));
    decipher.setAuthTag(value.subarray(tagStart, bodyStart));
    return Buffer.concat([decipher.update(value.subarray(bodyStart)), decipher.final()]);
  }

  async #readObject(filePath, metadata) {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Customer attachment object is not a regular file");
    const content = this.#decrypt(await readFile(filePath), metadata);
    const digest = createHash("sha256").update(content).digest();
    if (content.length !== Number(metadata.sizeBytes) || !digest.equals(Buffer.from(metadata.sha256))) {
      throw new Error("Customer attachment object integrity check failed");
    }
    return content;
  }

  async stage({ operationId, customerId, sensitivity, content, mimeType, originalFilename }) {
    await this.#ensureRoots();
    if (!Buffer.isBuffer(content) || content.length < 1 || content.length > this.config.maxFileBytes) {
      throw rejected("Customer attachment file size is invalid");
    }
    const declared = String(mimeType ?? "").toLowerCase().trim();
    if (!this.config.allowedMimeTypes.includes(declared) ||
        this.fileTypes.rejectionReason({ mimeType: declared, fileName: originalFilename, content }) ||
        !hasSafeBoundary(declared, content)) {
      throw rejected("Customer attachment file type is invalid");
    }
    const scan = await this.scanner.scan(content);
    if ((typeof scan === "string" ? scan : scan?.status) !== "clean") throw rejected("Customer attachment malware scan did not return clean");
    const name = storedName(operationId);
    const metadata = {
      operationId: String(operationId), customerId: Number(customerId), sensitivity,
      storedName: name, mimeType: declared, extension: extension(declared, originalFilename),
      sizeBytes: content.length, sha256: createHash("sha256").update(content).digest(),
      storageClass: sensitivity === "general" ? "general_private" : "bank_sensitive_private", scanStatus: "clean"
    };
    const encrypted = this.#encrypt(content, metadata);
    const shard = path.join(this.config.tempRoot, name.slice(0, 2));
    await mkdir(shard, { recursive: true, mode: 0o700 });
    const shardInfo = await lstat(shard);
    if (!shardInfo.isDirectory() || shardInfo.isSymbolicLink()) throw new Error("Customer attachment temp shard is not a regular directory");
    await chmod(shard, 0o700);
    const stagedPath = tempPath(this.config.tempRoot, name);
    try { await writeFile(stagedPath, encrypted, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      await this.#readObject(stagedPath, metadata);
    }
    return metadata;
  }

  async finalize(metadata) {
    await this.#ensureRoots();
    const name = validStoredName(metadata.storedName);
    const stagedPath = tempPath(this.config.tempRoot, name);
    const finalPath = path.join(this.#root(metadata.sensitivity), name);
    try { await this.#readObject(finalPath, metadata); return; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await rename(stagedPath, finalPath);
    await chmod(finalPath, 0o600);
    await this.#readObject(finalPath, metadata);
  }

  async read(metadata) {
    await this.#ensureRoots();
    return this.#readObject(path.join(this.#root(metadata.sensitivity), validStoredName(metadata.storedName)), metadata);
  }

  async recover(metadata) {
    try { await this.finalize(metadata); return "active"; }
    catch { return "storage_error"; }
  }

  async discardTemp(metadata) {
    await this.#ensureRoots();
    const stagedPath = tempPath(this.config.tempRoot, validStoredName(metadata.storedName));
    try {
      const info = await lstat(stagedPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Customer attachment temp object is not a regular file");
      await unlink(stagedPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

}

export const customerAttachmentStoredName = storedName;
