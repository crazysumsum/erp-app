import { createHash, randomBytes } from "node:crypto";
import { chmod, constants, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
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

function sha256(content) {
  return createHash("sha256").update(content).digest();
}

/**
 * Upload 將來源檔寫入 `<root>/source`（T43）。`root` 係 prepareSupplierImportRoot 回嘅真實路徑。
 * `O_EXCL`＋`O_NOFOLLOW`：已經有同名檔或者 symlink 都唔會寫；0600，寫完 fsync 先回。
 */
export async function writeSupplierImportSource(root, content) {
  const storedName = newSupplierImportStoredName();
  const file = supplierImportFilePath(root, "source", storedName);
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(file).catch(() => {});
    throw error;
  }
  await handle.close();
  return { storedName, sha256: sha256(content) };
}

export async function removeSupplierImportFile(root, kind, storedName) {
  await unlink(supplierImportFilePath(root, kind, storedName)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function sourceError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Precheck 讀返來源檔：唔跟 symlink；一定要係普通檔而且只有一個 hard link —— 喺 root 入面
 * 種一個 hard link 就可以讀到 root 以外嘅內容（REV-059 I-6）；內容要同 job 記低嘅 SHA-256 一樣。
 */
export async function readSupplierImportSource(root, storedName, { sha256: expected, maxBytes }) {
  let handle;
  try {
    // O_NONBLOCK：放喺度嘅 FIFO 唔會令 open 卡死（REV-064 I-5）；普通檔冇分別。
    handle = await open(supplierImportFilePath(root, "source", storedName), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (["ENOENT", "ELOOP", "EMLINK"].includes(error.code)) throw sourceError("SUPPLIER_IMPORT_SOURCE_UNAVAILABLE", "Supplier import source is missing or is a symlink");
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw sourceError("SUPPLIER_IMPORT_SOURCE_UNAVAILABLE", "Supplier import source is not a single-link regular file");
    if (info.size > maxBytes) throw sourceError("SUPPLIER_IMPORT_FILE_TOO_LARGE", "Supplier import source exceeds the size limit");
    const content = await handle.readFile();
    if (!sha256(content).equals(expected)) throw sourceError("SUPPLIER_IMPORT_SOURCE_UNAVAILABLE", "Supplier import source does not match its recorded SHA-256");
    return content;
  } finally {
    await handle.close();
  }
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

function purgeError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * 清理開始時記低 `<root>/<kind>` 嘅身份（`dev`＋`ino`）。刪每個檔之前都要再對一次（REV-059 L-6）：
 * 中途目錄被換成 symlink 或者第二個目錄，就唔刪。目錄未建立 → null（冇檔可刪）。
 */
export async function supplierImportDirectory(root, kind, { lstat: lstatFn = lstat } = {}) {
  const directory = path.dirname(supplierImportFilePath(root, kind, "0".repeat(64)));
  const rootInfo = await realDirectory(path.resolve(root), lstatFn);
  try {
    const info = await realDirectory(directory, lstatFn);
    if (info.dev !== rootInfo.dev) throw new Error("Supplier import directory must be on the root's filesystem");
    return { kind, path: directory, dev: info.dev, ino: info.ino };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * T48 刪檔（設計 §12.5；REV-059 L-6）：緊接 unlink 之前再驗一次——
 * 目錄仲係清理開始時嗰個（同 `dev`＋`ino`）；檔案係普通檔、同一個 filesystem、只有一個 hard link。
 * 然後 unlink 驗過嘅目錄 + server 產生嘅檔名，所以唔會跟 symlink、唔會離開 root。
 *
 * 回 `"deleted"`、`"missing"`（本身已經冇，idempotent），或者 `"too_new"`（`notNewerThanMs` 之後先改過，
 * 留俾 upload 寫完 job 先）。唔安全就拋 `SUPPLIER_IMPORT_PURGE_UNSAFE`。
 */
export async function removeVerifiedSupplierImportFile(directory, storedName, { notNewerThanMs, lstat: lstatFn = lstat } = {}) {
  if (!STORED_NAME.test(String(storedName ?? ""))) throw new TypeError("Supplier import stored name is invalid");
  const now = await lstatFn(directory.path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!now?.isDirectory() || now.dev !== directory.dev || now.ino !== directory.ino) {
    throw purgeError("SUPPLIER_IMPORT_PURGE_UNSAFE", "Supplier import directory changed since the purge started");
  }
  const file = path.join(directory.path, storedName);
  let info;
  try {
    info = await lstatFn(file);
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  // 太新嘅檔乜都唔做（未算失敗）：可能係 upload 寫咗檔、未入 job。
  if (notNewerThanMs !== undefined && info.mtimeMs > notNewerThanMs) return "too_new";
  if (!info.isFile() || info.dev !== directory.dev || info.nlink !== 1) {
    throw purgeError("SUPPLIER_IMPORT_PURGE_UNSAFE", "Supplier import file is not a single-link regular file on the root's filesystem");
  }
  try {
    await unlink(file);
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
  return "deleted";
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
export async function prepareSupplierImportRoot(root, otherRoots = [],
  { uid = process.getuid?.(), lstat: lstatFn = lstat } = {}) {
  root = path.resolve(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // root 本身唔可以係 symlink；佢上面嘅路徑可以，但之後一律用真實路徑，因為上面嗰個 symlink
  // 開機之後可以被換走（REV-063 L-10）。
  if (!(await lstatFn(root)).isDirectory()) throw new Error("Supplier import root is not a regular directory");
  root = await realpath(root);
  // 任何一層上層目錄如果人人寫得入而又冇 sticky bit，或者屬於其他 user，就可以將下面嗰層改名
  // 再換做自己嘅目錄或 symlink（REV-061 L-4）。用真實路徑逐層睇到 `/`：淨係睇直屬上層，一個
  // symlink 上層或者 0777 嘅祖父目錄就過到（REV-062 L-7）。
  for (let directory = path.dirname(root); ; directory = path.dirname(directory)) {
    const info = await lstatFn(directory);
    if (((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0) ||
        (uid !== undefined && info.uid !== uid && info.uid !== 0)) {
      throw new Error(`Supplier import root's ancestor ${directory} must not be replaceable by other users`);
    }
    if (directory === path.dirname(directory)) break;
  }
  const rootInfo = await lstatFn(root);
  if (!rootInfo.isDirectory()) throw new Error("Supplier import root is not a regular directory");
  if (uid !== undefined && rootInfo.uid !== uid) throw new Error("Supplier import root must be owned by the service user");
  if ((rootInfo.mode & 0o022) !== 0) throw new Error("Supplier import root must not be writable by group or others");
  await chmod(root, 0o700);
  for (const kind of KINDS) {
    const directory = path.join(root, kind);
    await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    const info = await lstatFn(directory);
    if (!info.isDirectory() || info.dev !== rootInfo.dev || (uid !== undefined && info.uid !== uid)) {
      throw new Error("Supplier import directories must be regular, on the root's filesystem and owned by the service user");
    }
    await chmod(directory, 0o700);
  }

  const real = root;
  for (const other of otherRoots.filter(Boolean)) {
    let otherReal;
    let otherInfo;
    try {
      otherReal = await realpath(other);
      otherInfo = await lstatFn(otherReal);
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
