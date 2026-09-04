import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("../../../", import.meta.url));

// 沒有這些上限的話，一個打錯的部署設定要等到第一次真的觸發（一棵深到瀏覽器
// tree 元件畫不動的分類、一個大到把交易拖過 request timeout 的匯入 batch）
// 才會被發現。啟動時擋下來，代價由這裡的常數承擔一次，而不是由使用者在正式
// 環境撞到一次。
const CATEGORY_MAX_DEPTH_CEILING = 20;
const MEDIA_BYTES_CEILING = 104_857_600; // 100MB；與 framework upload 的緩衝上限同一數量級。
const MEDIA_ORPHAN_GRACE_CEILING_MS = 30 * 24 * 60 * 60 * 1000; // 30 天。
const IMPORT_MAX_ROWS_CEILING = 50_000; // NFR-003／NFR-004 的 10,000 列基準之上留出處理裕度，但不是無界。
const IMPORT_TRANSACTION_TIMEOUT_CEILING_MS = 10 * 60 * 1000; // 10 分鐘，對齊 NFR-004 的系統處理時間上限。

function positiveInteger(value, key, { maximum } = {}) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Item config "${key}" must be a positive integer`);
  }

  if (maximum !== undefined && number > maximum) {
    throw new Error(`Item config "${key}" must not exceed ${maximum}`);
  }

  return number;
}

/**
 * Item Management 部署設定的正規化與啟動期驗證。設計說明見
 * docs/items_management/design_spec.md §12.1。
 *
 * 跟 normalizeDeviceBindingConfig／normalizeUploadConfig 同一個目的：把「型別
 * 錯、零、負數、超出安全上限」這幾種在執行期只會表現成某個功能默默壞掉的設定
 * 錯誤，一律擋在啟動當下，並且指名是哪一個欄位。
 */
export function normalizeItemConfig(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Item config must be an object");
  }

  const categoryMaxDepth = positiveInteger(
    source.categoryMaxDepth ?? 8,
    "categoryMaxDepth",
    { maximum: CATEGORY_MAX_DEPTH_CEILING }
  );

  const mediaDirectorySource = String(source.mediaDirectory || "").trim();

  if (!mediaDirectorySource) {
    throw new Error('Item config "mediaDirectory" must be a non-empty string');
  }

  // 正規化成受控的 absolute path：相對路徑一律以 server 目錄為基準解析，跟
  // config/logging.js 的 directory 及 framework/upload 的 directory 同一慣例，
  // 讓 ItemMediaService／ItemMediaCleanupJob 之外沒有人需要自己再組一次這個
  // 路徑。
  const mediaDirectory = path.isAbsolute(mediaDirectorySource)
    ? mediaDirectorySource
    : path.resolve(serverRoot, mediaDirectorySource);

  const imageMaxBytes = positiveInteger(
    source.imageMaxBytes ?? 5_242_880,
    "imageMaxBytes",
    { maximum: MEDIA_BYTES_CEILING }
  );
  const attachmentMaxBytes = positiveInteger(
    source.attachmentMaxBytes ?? 10_485_760,
    "attachmentMaxBytes",
    { maximum: MEDIA_BYTES_CEILING }
  );
  const mediaOrphanGraceMs = positiveInteger(
    source.mediaOrphanGraceMs ?? 86_400_000,
    "mediaOrphanGraceMs",
    { maximum: MEDIA_ORPHAN_GRACE_CEILING_MS }
  );

  const importMaxRows = positiveInteger(
    source.importMaxRows ?? 10_000,
    "importMaxRows",
    { maximum: IMPORT_MAX_ROWS_CEILING }
  );
  const importBatchSize = positiveInteger(
    source.importBatchSize ?? 200,
    "importBatchSize"
  );

  if (importBatchSize > importMaxRows) {
    throw new Error(
      `Item config "importBatchSize" (${importBatchSize}) must not exceed "importMaxRows" ` +
        `(${importMaxRows}), otherwise a single batch could never fit inside one job's row limit`
    );
  }

  const importTransactionTimeoutMs = positiveInteger(
    source.importTransactionTimeoutMs ?? 120_000,
    "importTransactionTimeoutMs",
    { maximum: IMPORT_TRANSACTION_TIMEOUT_CEILING_MS }
  );

  return Object.freeze({
    categoryMaxDepth,
    mediaDirectory,
    imageMaxBytes,
    attachmentMaxBytes,
    mediaOrphanGraceMs,
    importMaxRows,
    importBatchSize,
    importTransactionTimeoutMs
  });
}
