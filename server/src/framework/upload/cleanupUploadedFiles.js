import { lstat, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareDiskTempDirectory } from "./normalizeUploadConfig.js";

const diskRequests = new WeakMap();
const activeDirectories = new Set();
const OWNER_MARKER = "erp-disk-upload-v1\n";
const STORED_FILE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:\.[a-z0-9]+)?$/;

export async function registerDiskUpload(req, root, directory, releaseSlot) {
  prepareDiskTempDirectory(root);
  if (path.dirname(directory) !== root) throw new Error("Disk request directory must be directly below its root");
  const stat = await lstat(directory);
  if (!privateDirectory(stat)) throw new Error("Disk request directory must be private and owned");
  // Track ownership before marker creation so even a failed write can be cleaned safely.
  diskRequests.set(req, { root, directory, dev: stat.dev, ino: stat.ino, cleanup: null, releaseSlot });
  activeDirectories.add(directory);
  await writeFile(path.join(directory, ".upload-owner"), OWNER_MARKER, { flag: "wx", mode: 0o600 });
}

function privateDirectory(stat) {
  return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o700 &&
    (!process.getuid || stat.uid === process.getuid());
}

async function removeOwnedDirectory(owned, { requireMarker = true } = {}) {
  prepareDiskTempDirectory(owned.root);
  if (path.dirname(owned.directory) !== owned.root) throw new Error("Disk cleanup escaped its root");
  let stat;
  try { stat = await lstat(owned.directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (!privateDirectory(stat) || stat.dev !== owned.dev || stat.ino !== owned.ino) throw new Error("Disk directory ownership changed");
  const entries = await readdir(owned.directory, { withFileTypes: true });
  // Validate every entry before deleting anything; never follow symlinks or recurse.
  for (const entry of entries) {
    if (!entry.isFile() || (entry.name !== ".upload-owner" && !STORED_FILE.test(entry.name))) throw new Error("Unexpected disk upload entry");
  }
  const marker = entries.some((entry) => entry.name === ".upload-owner");
  if (marker && await readFile(path.join(owned.directory, ".upload-owner"), "utf8") !== OWNER_MARKER) throw new Error("Disk upload marker mismatch");
  if (requireMarker && !marker) throw new Error("Disk upload marker missing");
  const removed = [];
  for (const entry of entries.filter((entry) => entry.name !== ".upload-owner")) {
    await unlink(path.join(owned.directory, entry.name));
    removed.push(entry.name);
  }
  if (marker) await unlink(path.join(owned.directory, ".upload-owner"));
  await rmdir(owned.directory);
  return removed;
}

export async function cleanupOrphanedUploads(root, { maxAgeSeconds, nowMs = Date.now() }, logger = null) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) throw new TypeError("Orphan age must be a positive integer");
  root = prepareDiskTempDirectory(root);
  const removed = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!/^upload-[a-zA-Z0-9]{6}$/.test(entry.name) || !entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    if (activeDirectories.has(directory)) continue;
    try {
      const stat = await lstat(directory);
      if (!privateDirectory(stat) || nowMs - stat.mtimeMs < maxAgeSeconds * 1000) continue;
      await removeOwnedDirectory({ root, directory, dev: stat.dev, ino: stat.ino });
      removed.push(entry.name);
    } catch {
      void logger?.error?.("upload.orphan_cleanup_failed", "Orphan upload could not be safely removed", { directory: entry.name });
    }
  }
  return removed;
}


/**
 * 刪除本次請求已落盤、但沒有任何東西接手的上傳檔案。
 *
 * 上傳一定要在 schema 驗證與 handler 之前完成——文字欄位得先解析出來才有東西
 * 可驗證。代價是「檔案已經在磁碟上，請求卻還可能失敗」：驗證失敗、handler 拋
 * 錯、idempotency 重播，全都會留下沒有任何紀錄指向它的孤兒檔。這裡負責在那些
 * 路徑上收尾。
 *
 * 只在 handler 沒有成功回應時呼叫。handler 成功即代表檔案已經被接手（通常是把
 * path 寫進資料庫），此時刪檔會刪掉正在使用中的資料。
 */
export async function cleanupUploadedFiles(req, logger, reason) {
  const owned = diskRequests.get(req);
  if (owned) {
    owned.cleanup ??= removeOwnedDirectory(owned, { requireMarker: false }).then((removed) => {
      req.files = Object.freeze([]);
      activeDirectories.delete(owned.directory);
      diskRequests.delete(req);
      owned.releaseSlot?.();
      return removed;
    }).catch(() => {
      owned.cleanup = null;
      void logger?.error?.("upload.cleanup_failed", "Disk upload could not be safely removed", { requestId: req.requestId || null, reason });
      return [];
    });
    return owned.cleanup;
  }
  const files = Array.isArray(req.files) ? req.files : [];

  if (files.length === 0) {
    return [];
  }

  // 先清空再刪除：同一個請求上不會有第二次清理，也不會有 handler 在事後
  // 讀到已經不存在的路徑。
  req.files = Object.freeze([]);

  for (const file of files) {
    if (Buffer.isBuffer(file.buffer)) file.buffer.fill(0);
  }

  const removed = [];
  const failures = [];

  await Promise.all(
    files.filter((file) => file.path).map(async (file) => {
      try {
        await unlink(file.path);
        removed.push(file.storedName);
      } catch (error) {
        // ENOENT 代表 handler 已經把檔案搬走或改名，那是正常結果。
        if (error.code !== "ENOENT") {
          failures.push({ storedName: file.storedName, message: error.message });
        }
      }
    })
  );

  if (removed.length > 0) {
    void logger?.info?.("upload.cleaned_up", "Uploaded files removed after a failed request", {
      requestId: req.requestId || null,
      reason: reason || "request_failed",
      files: removed
    });
  }

  if (failures.length > 0) {
    // 刪不掉就是磁碟上真的留了垃圾，必須看得見，否則只會靜靜長大。
    void logger?.error?.("upload.cleanup_failed", "Uploaded files could not be removed", {
      requestId: req.requestId || null,
      reason: reason || "request_failed",
      failures
    });
  }

  return removed;
}
