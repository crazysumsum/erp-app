import { randomBytes } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Supplier import 檔案放喺邊、叫咩名（T41；設計 §12.4）。
 *
 * - 檔名一律由 server 產生：64 位 hex。上載者畀嘅檔名唔會落到檔案系統，所以冇 `../`、
 *   冇特殊字元、冇撞名。
 * - 檔案只可以喺 `<root>/source` 或 `<root>/result`。Root、目錄同檔案一律用 lstat 判斷，
 *   唔跟 symlink；目錄唔同 filesystem（mount 咗第二隻碟）都當越界。
 */
const KINDS = Object.freeze(["source", "result"]);
const STORED_NAME = /^[0-9a-f]{64}$/u;

/** 三件背景工作各自一個名，scheduler.js 嘅 `jobs` 可以逐件開關或者改頻率。 */
export const SUPPLIER_IMPORT_JOB_NAMES = Object.freeze({
  precheck: "supplier.import.precheck",
  worker: "supplier.import.execute",
  purge: "supplier.import.purge"
});

export function newSupplierImportStoredName() {
  return randomBytes(32).toString("hex");
}

export function supplierImportFilePath(root, kind, storedName) {
  if (!root || !path.isAbsolute(root)) throw new TypeError("Supplier import root must be an absolute path");
  // resolve：`root/` 或者 `root/.` 會令 lstat 跟住 symlink 走（REV-059 L-4）。
  root = path.resolve(root);
  if (!KINDS.includes(kind)) throw new TypeError("Supplier import file kind is invalid");
  if (!STORED_NAME.test(String(storedName ?? ""))) throw new TypeError("Supplier import stored name is invalid");
  return path.join(root, kind, storedName);
}

async function realDirectory(directory, lstatFn) {
  const info = await lstatFn(directory);
  if (!info.isDirectory()) throw new Error("Supplier import path is not a regular directory");
  return info;
}

/**
 * 清理用：列出 `<root>/<kind>` 入面由 server 產生嘅檔。Symlink、子目錄同名唔啱嘅
 * 一律跳過 —— `Dirent.isFile()` 對 symlink 係 false，所以唔會跟過去。目錄未建立就係冇檔。
 *
 * 只係一份清單：刪除之前要再驗一次目錄同檔案，因為列完到刪之間目錄可以被換成 symlink
 * （REV-059 L-6，T48 嘅責任，見 implementation/61_task_041_carry_forward.md）。
 * `lstat` 可以注入，等測試做到「唔同 filesystem」而唔使 mount 碟。
 */
export async function listSupplierImportFiles(root, kind, { lstat: lstatFn = lstat } = {}) {
  const directory = path.dirname(supplierImportFilePath(root, kind, "0".repeat(64)));
  const rootInfo = await realDirectory(path.resolve(root), lstatFn);
  let entries;
  try {
    const info = await realDirectory(directory, lstatFn);
    if (info.dev !== rootInfo.dev) throw new Error("Supplier import directory must be on the root's filesystem");
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && STORED_NAME.test(entry.name))
    .map((entry) => ({ storedName: entry.name, path: path.join(directory, entry.name) }));
}
