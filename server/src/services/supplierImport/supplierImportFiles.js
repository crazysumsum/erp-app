import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readdir, realpath } from "node:fs/promises";
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
 * （REV-059 L-6，T48 嘅責任，見 implementation/62_task_041_carry_forward.md）。
 * `lstat` 可以注入，等測試做到「唔同 filesystem」而唔使 mount 碟。正式 code 唔好傳：傳 `stat`
 * 就會跟 symlink，成個檢查就冇咗（REV-060 I-11）。Root 先 resolve，因為 `root/` 或者 `root/.`
 * 會令 lstat 跟住 symlink 走（REV-059 L-4）。
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

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Import 服務啟動時準備 root（T42，HD-041；REV-059 L-5、L-6、L-7）。
 *
 * - root 同 `source`／`result` 建成 0700，擁有者一定要係呢個 process 嘅 user；group 或其他人
 *   寫得入嘅 root（例如 /tmp）拒絕 —— 否則任何本機 user 都可以預先放一個自己嘅 `source`。
 * - 用真實路徑同 `dev`+`ino` 再比一次其他模組嘅目錄：開機嗰個檢查（applicationConfiguration）
 *   只比字串，唔分大細階唔同嘅 filesystem 同經 symlink 嘅上層目錄都過得到。
 */
export async function prepareSupplierImportRoot(root, otherRoots = [], { uid = process.getuid?.() } = {}) {
  root = path.resolve(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory()) throw new Error("Supplier import root is not a regular directory");
  if (uid !== undefined && rootInfo.uid !== uid) throw new Error("Supplier import root must be owned by the service user");
  if ((rootInfo.mode & 0o022) !== 0) throw new Error("Supplier import root must not be writable by group or others");
  await chmod(root, 0o700);
  for (const kind of KINDS) {
    const directory = path.join(root, kind);
    await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.dev !== rootInfo.dev || (uid !== undefined && info.uid !== uid)) {
      throw new Error("Supplier import directories must be regular, on the root's filesystem and owned by the service user");
    }
    await chmod(directory, 0o700);
  }

  const real = await realpath(root);
  for (const other of otherRoots.filter(Boolean)) {
    let otherReal;
    let otherInfo;
    try {
      otherReal = await realpath(other);
      otherInfo = await lstat(otherReal);
    } catch (error) {
      if (error.code === "ENOENT") continue;   // 未建立嘅目錄唔會同佢重疊
      throw error;
    }
    const sameDirectory = otherInfo.dev === rootInfo.dev && otherInfo.ino === rootInfo.ino;
    // realpath 會還原真實嘅大細階，所以唔分大細階嘅 filesystem 上面換咗大細階都比得到。
    if (sameDirectory || contains(otherReal, real) || contains(real, otherReal)) {
      throw new Error("Supplier import root overlaps another module's file directory");
    }
  }
  return real;
}
