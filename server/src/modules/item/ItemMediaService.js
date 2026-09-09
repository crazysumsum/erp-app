/**
 * Item／SKU media 的 metadata：attach、update、download 解析、delete 及
 * cleanup job 用嘅分頁引用查詢。設計說明見
 * docs/items_management/design_spec.md §5.11、§6.6、§8.5。
 *
 * 實體檔案的落盤／驗證在 upload middleware（`req.files[0]`）已經完成——中間件
 * 通過 content-signature 驗證後才寫入磁碟，`attach()` 收到的檔案已經在受控
 * 目錄底下。這裡只負責 metadata：驗證 target／version、決定 primary、寫
 * `item_media` 與 audit。上傳驗證失敗或 DB insert 失敗時，已落盤的檔案由
 * apiDispatcher 的 `cleanupUploadedFiles()` 自動清走（見
 * src/framework/middleware/apiDispatcher.js），這裡不需要自己做 orphan 清理。
 *
 * `delete()` 只在交易內刪 metadata 及寫 audit，commit 後待刪嘅 `storedName`
 * 交返俾呼叫端（handler）；實體 unlink 在交易外進行，失敗屬於已知的「DB 與
 * 檔案系統無法用同一交易」情況，交由 `ItemMediaCleanupJob` 之後重試——見
 * design_spec.md §7.3 對這個兩階段刪除的說明。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與
 * ItemAdminService／ItemCatalogService 同一個理由。
 */
import {
  mediaFileTooLarge,
  mediaKindMismatch,
  mediaNotFound,
  mediaPrimaryRequiresImage,
  itemNotFound,
  skuNotFound,
  versionConflict
} from "./itemErrors.js";
import { MEDIA_KIND_MIME_TYPES } from "./itemConstants.js";
import { ItemAuditLogService } from "./ItemAuditLogService.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";

export class ItemMediaService {
  constructor({ database, logger, time, imageMaxBytes, attachmentMaxBytes } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemMediaService requires database, logger and time");
    }
    if (!Number.isInteger(imageMaxBytes) || imageMaxBytes <= 0) {
      throw new TypeError("ItemMediaService requires a positive integer imageMaxBytes");
    }
    if (!Number.isInteger(attachmentMaxBytes) || attachmentMaxBytes <= 0) {
      throw new TypeError("ItemMediaService requires a positive integer attachmentMaxBytes");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
    this.imageMaxBytes = imageMaxBytes;
    this.attachmentMaxBytes = attachmentMaxBytes;
    this.auditLog = new ItemAuditLogService({ database, logger, time });
  }

  /**
   * 掛一個已經落盤驗證過嘅檔案去 Item 或 SKU 底下。`targetType` 為 "sku" 時，
   * `item_media.item_id` 取自該 SKU 現在嘅 `item_id`（media 一律同時記住兩者，
   * 唔淨係記 sku_id——列表／primary scope 兩種查詢都要用得到 item_id）。
   */
  async attach({
    actorId,
    claimedRoles,
    claimedPermissions,
    targetType,
    targetId,
    kind,
    isPrimary,
    sortOrder,
    version,
    file,
    requestId,
    ip
  }) {
    this.#assertKindMatchesFile(kind, file);

    if (isPrimary && kind !== "image") {
      throw mediaPrimaryRequiresImage();
    }

    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const nowMs = this.time.nowMs();
      const target = await this.#resolveTarget(connection, { targetType, targetId, version });

      if (isPrimary) {
        // Scope 內舊 primary 先清 0，先設新值——先後次序係重點：反過來的話,
        // 新舊兩列會在同一個 transaction 裡短暫同時等於同一個 primary_scope，
        // 撞 UNIQUE(primary_scope)。見 0023 migration 對 primary_scope 的說明。
        await connection.execute(
          `UPDATE item_media SET is_primary = 0
             WHERE item_id = ? AND sku_id <=> ? AND media_kind = 'image' AND is_primary = 1`,
          [target.itemId, target.skuId]
        );
      }

      const [result] = await connection.execute(
        `INSERT INTO item_media
           (item_id, sku_id, media_kind, stored_name, original_name, mime_type, byte_size, sha256,
            is_primary, sort_order, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          target.itemId,
          target.skuId,
          kind,
          file.storedName,
          file.originalName,
          file.mimeType,
          file.size,
          file.contentHash,
          isPrimary ? 1 : 0,
          sortOrder ?? 0,
          nowMs,
          actorId
        ]
      );
      const mediaId = result.insertId;

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "media.upload",
        targetType: "media",
        targetId: mediaId,
        targetLabel: file.originalName,
        detail: {
          itemId: target.itemId,
          skuId: target.skuId,
          kind,
          storedName: file.storedName,
          byteSize: file.size,
          isPrimary: Boolean(isPrimary)
        },
        requestId,
        ip
      });

      return this.#toSummary({
        id: mediaId,
        item_id: target.itemId,
        sku_id: target.skuId,
        media_kind: kind,
        original_name: file.originalName,
        mime_type: file.mimeType,
        byte_size: file.size,
        is_primary: isPrimary ? 1 : 0,
        sort_order: sortOrder ?? 0,
        created_at: nowMs
      });
    });
  }

  /**
   * 只接受 display name（`original_name`）、sort order、primary；唔接受修改
   * path／hash／MIME（§8.5）。呢張表冇逐行 version（§5.11 冚都冇呢個欄），
   * update 淨係用 id 識別，冇 compare-and-set——同其他 catalog 資源唔同，
   * 呢幾個都係細粒度、低競爭嘅顯示欄位，撞車代價細，屬於已確認嘅設計取捨。
   */
  async update({ actorId, claimedRoles, claimedPermissions, id, displayName, sortOrder, isPrimary, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const current = await this.#requireMedia(connection, id);

      if (isPrimary && current.media_kind !== "image") {
        throw mediaPrimaryRequiresImage();
      }

      const nextOriginalName =
        displayName !== undefined ? String(displayName).trim() : current.original_name;
      const nextSortOrder = sortOrder !== undefined ? sortOrder : current.sort_order;
      const nextIsPrimary = isPrimary !== undefined ? isPrimary : Boolean(current.is_primary);

      if (nextIsPrimary && !current.is_primary) {
        await connection.execute(
          `UPDATE item_media SET is_primary = 0
             WHERE item_id = ? AND sku_id <=> ? AND media_kind = 'image' AND is_primary = 1`,
          [current.item_id, current.sku_id]
        );
      }

      await connection.execute(
        `UPDATE item_media
            SET original_name = ?, sort_order = ?, is_primary = ?
          WHERE id = ?`,
        [nextOriginalName, nextSortOrder, nextIsPrimary ? 1 : 0, id]
      );

      const detail = {};
      if (nextOriginalName !== current.original_name) {
        detail.displayName = { before: current.original_name, after: nextOriginalName };
      }
      if (Number(nextSortOrder) !== Number(current.sort_order)) {
        detail.sortOrder = { before: current.sort_order, after: nextSortOrder };
      }
      if (nextIsPrimary !== Boolean(current.is_primary)) {
        detail.isPrimary = { before: Boolean(current.is_primary), after: nextIsPrimary };
      }

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "media.update",
        targetType: "media",
        targetId: id,
        targetLabel: nextOriginalName,
        detail,
        requestId,
        ip,
        reason: ""
      });

      return this.#toSummary({ ...current, original_name: nextOriginalName, sort_order: nextSortOrder, is_primary: nextIsPrimary ? 1 : 0 });
    });
  }

  /**
   * 解析下載目標：查 stored name 並確認格式安全（不含路徑分隔符）。實際嘅
   * root-containment 檢查由 `sendFileResponse()`／`openFileWithinDirectory()`
   * 負責（見 src/framework/http/fileResponse.js）；這裡的檢查是多一層防線——
   * `stored_name` 理論上只會是伺服器自己生成的值，不應該含路徑分隔符，一旦
   * 出現代表資料已經不正常，寧願回 404 也不要把它交給檔案系統解析。
   */
  async resolveDownload({ id }) {
    const media = await this.#requireMedia(this.database, id);

    if (media.stored_name.includes("/") || media.stored_name.includes("\\") || media.stored_name.includes("..")) {
      void this.logger.error("item.media_stored_name_invalid", "Stored media name failed the path safety check", {
        mediaId: id,
        storedName: media.stored_name
      });
      throw mediaNotFound(id);
    }

    return {
      storedName: media.stored_name,
      originalName: media.original_name,
      mimeType: media.mime_type,
      mediaKind: media.media_kind
    };
  }

  /**
   * 交易內刪 metadata 及寫 audit，commit 後回傳待刪嘅 `storedName`——實體
   * unlink 由呼叫端喺交易外進行（見檔案開頭說明）。
   */
  async delete({ actorId, claimedRoles, claimedPermissions, id, reason, requestId, ip }) {
    return this.database.withTransaction(async (connection) => {
      const actor = await assertActorFresh(connection, { actorId, claimedRoles, claimedPermissions });
      const media = await this.#requireMedia(connection, id);

      await connection.execute("DELETE FROM item_media WHERE id = ?", [id]);

      await this.auditLog.record(connection, {
        actorUserId: actorId,
        actorUsername: actor.username,
        action: "media.delete",
        targetType: "media",
        targetId: id,
        targetLabel: media.original_name,
        detail: { itemId: media.item_id, skuId: media.sku_id, storedName: media.stored_name },
        reason,
        requestId,
        ip
      });

      return { id, storedName: media.stored_name };
    });
  }

  /**
   * 俾 `ItemMediaCleanupJob` 分頁攞現存引用嘅 `stored_name`，用嚟分辨受控目錄
   * 底下邊啲檔案仲有 DB 記錄、邊啲已經係 orphan。純讀、唔開交易。
   */
  async findStoredNames({ afterId = 0, limit = 1000 } = {}) {
    const [rows] = await this.database.query(
      "SELECT id, stored_name FROM item_media WHERE id > ? ORDER BY id ASC LIMIT ?",
      [afterId, limit]
    );

    return rows.map((row) => ({ id: Number(row.id), storedName: row.stored_name }));
  }

  // -------------------------------------------------------------------------

  #assertKindMatchesFile(kind, file) {
    const allowedMimeTypes = MEDIA_KIND_MIME_TYPES[kind] ?? [];

    if (!allowedMimeTypes.includes(file.mimeType)) {
      throw mediaKindMismatch(kind, file.mimeType);
    }

    const maxBytes = kind === "image" ? this.imageMaxBytes : this.attachmentMaxBytes;
    if (file.size > maxBytes) {
      throw mediaFileTooLarge(kind, maxBytes);
    }
  }

  async #resolveTarget(connection, { targetType, targetId, version }) {
    if (targetType === "item") {
      const [[row]] = await connection.query("SELECT id, version FROM items WHERE id = ?", [targetId]);
      if (!row) {
        throw itemNotFound(targetId);
      }
      if (Number(row.version) !== Number(version)) {
        throw versionConflict();
      }
      return { itemId: Number(row.id), skuId: null };
    }

    const [[row]] = await connection.query(
      "SELECT id, item_id, version FROM item_skus WHERE id = ?",
      [targetId]
    );
    if (!row) {
      throw skuNotFound(targetId);
    }
    if (Number(row.version) !== Number(version)) {
      throw versionConflict();
    }
    return { itemId: Number(row.item_id), skuId: Number(row.id) };
  }

  async #requireMedia(queryable, id) {
    const [[row]] = await queryable.query(
      `SELECT id, item_id, sku_id, media_kind, stored_name, original_name, mime_type, byte_size,
              sha256, is_primary, sort_order, created_at, created_by
         FROM item_media WHERE id = ?`,
      [id]
    );

    if (!row) {
      throw mediaNotFound(id);
    }

    return row;
  }

  #toSummary(row) {
    return {
      id: Number(row.id),
      itemId: Number(row.item_id),
      skuId: row.sku_id === null || row.sku_id === undefined ? null : Number(row.sku_id),
      mediaKind: row.media_kind,
      originalName: row.original_name,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      isPrimary: Boolean(row.is_primary),
      sortOrder: Number(row.sort_order),
      createdAt: Number(row.created_at)
    };
  }
}
