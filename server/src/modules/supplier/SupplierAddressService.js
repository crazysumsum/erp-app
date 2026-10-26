import { assertActorFresh } from "../authorization/directoryLookups.js";
import { changedFieldsDetail, purposeList, sortedPurposes } from "./auditChanges.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierChildNotFound, supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { containsControl } from "./supplierNormalization.js";
import { toAddressResponse } from "./supplierProjections.js";
import { nextSortOrder, swapWithNeighbour } from "./partyOrder.js";

export const SUPPLIER_ADDRESS_PURPOSES = Object.freeze(["registered", "office", "ordering", "return", "remittance", "other"]);
const PURPOSE_SET = new Set(SUPPLIER_ADDRESS_PURPOSES);

/** UI 上嘅欄位名：錯誤訊息要講明係邊個欄位、點解錯，舊資料（例如備註有換行）先知點改（REV-106 M-2）。 */
const FIELD_LABELS = Object.freeze({ label: "地址標籤", addressLine1: "地址行 1", addressLine2: "地址行 2", addressLine3: "地址行 3",
  city: "城市", stateRegion: "州／地區", postalCode: "郵政編碼", phone: "電話", notes: "備註" });

/** 同 contact、識別資料一樣：限長度（同 DB 欄位），拒絕控制字元，包括換行（DEF-005，HD-116 A）。 */
function text(value, field, maxLength) {
  const normalized = String(value ?? "").trim();
  if (containsControl(normalized)) {
    throw invalidSupplierInput("SUPPLIER_ADDRESS_INVALID", `${FIELD_LABELS[field]}不可包含換行或其他控制字元`, { field });
  }
  if (Array.from(normalized).length > maxLength) {
    throw invalidSupplierInput("SUPPLIER_ADDRESS_INVALID", `${FIELD_LABELS[field]}不可超過 ${maxLength} 個字元`, { field });
  }
  return normalized;
}

export function normalizeAddress(input) {
  const purposes = input.purposes ?? [];
  if (!Array.isArray(purposes) || new Set(purposes.map((purpose) => purpose.purposeCode)).size !== purposes.length) {
    throw invalidSupplierInput("SUPPLIER_ADDRESS_PURPOSE_INVALID", "地址用途不可重複");
  }
  for (const purpose of purposes) {
    if (!PURPOSE_SET.has(purpose.purposeCode)) {
      throw invalidSupplierInput("SUPPLIER_ADDRESS_PURPOSE_INVALID", "地址用途不正確");
    }
  }
  const countryCode = String(input.countryCode ?? "").trim().toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/u.test(countryCode)) {
    throw invalidSupplierInput("SUPPLIER_ADDRESS_COUNTRY_INVALID", "國家／地區代碼必須是兩個英文字母");
  }
  return {
    label: text(input.label, "label", 100),
    addressLine1: text(input.addressLine1, "addressLine1", 190),
    addressLine2: text(input.addressLine2, "addressLine2", 190),
    addressLine3: text(input.addressLine3, "addressLine3", 190),
    city: text(input.city, "city", 100),
    stateRegion: text(input.stateRegion, "stateRegion", 100),
    postalCode: text(input.postalCode, "postalCode", 100),
    countryCode: countryCode || null,
    phone: text(input.phone, "phone", 50),
    notes: text(input.notes, "notes", 500),
    purposes: purposes.map((purpose) => ({ purposeCode: purpose.purposeCode, isPrimary: Boolean(purpose.isPrimary) }))
  };
}

export class SupplierAddressService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit } = {}) {
    if (!database || !logger || !time) throw new TypeError("SupplierAddressService requires database, logger and time");
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
  }

  async #supplierForUpdate(connection, supplierId) {
    const [[supplier]] = await connection.query("SELECT id, supplier_code FROM suppliers WHERE id = ? FOR UPDATE", [supplierId]);
    if (!supplier) throw supplierNotFound(supplierId);
    return supplier;
  }

  async #addressForUpdate(connection, supplierId, addressId) {
    const [[address]] = await connection.query(
      "SELECT * FROM supplier_addresses WHERE id = ? AND supplier_id = ? FOR UPDATE",
      [addressId, supplierId]
    );
    if (!address) throw supplierChildNotFound("address");
    return address;
  }

  async #replacePurposes(connection, { supplierId, addressId, purposes, actorId, nowMs, replace }) {
    for (const purpose of purposes.filter((item) => item.isPrimary)) {
      await connection.execute(
        `UPDATE supplier_address_purposes
            SET is_primary = 0, updated_at = ?, updated_by = ?
          WHERE supplier_id = ? AND purpose_code = ? AND address_id != ? AND is_primary = 1`,
        [nowMs, actorId, supplierId, purpose.purposeCode, addressId]
      );
    }
    if (replace) {
      await connection.execute("DELETE FROM supplier_address_purposes WHERE address_id = ? AND supplier_id = ?", [addressId, supplierId]);
    }
    for (const purpose of purposes) {
      await connection.execute(
        `INSERT INTO supplier_address_purposes
          (address_id, supplier_id, purpose_code, is_primary, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [addressId, supplierId, purpose.purposeCode, purpose.isPrimary ? 1 : 0, nowMs, nowMs, actorId, actorId]
      );
    }
  }

  async #project(connection, supplierId, addressId) {
    const [[row]] = await connection.query(
      "SELECT a.* FROM supplier_addresses a WHERE a.id = ? AND a.supplier_id = ?",
      [addressId, supplierId]
    );
    const [purposes] = await connection.query(
      "SELECT purpose_code, is_primary FROM supplier_address_purposes WHERE address_id = ? AND supplier_id = ? ORDER BY purpose_code",
      [addressId, supplierId]
    );
    return toAddressResponse(row, purposes);
  }

  async create(input) {
    normalizeAddress(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      return this.createInTransaction(connection, { actor, input });
    });
  }

  /**
   * 建立嘅核心，喺 caller 嘅 transaction 入面做（CSV 匯入同 Supplier 一齊 commit，HD-060 2A）。
   * `actor` 係已經驗過嘅 `{ username }`。
   */
  async createInTransaction(connection, { actor, input }) {
    const address = normalizeAddress(input);
    await this.#supplierForUpdate(connection, input.supplierId);
    const nowMs = this.time.nowMs();
    const [result] = await connection.execute(
      `INSERT INTO supplier_addresses
        (supplier_id, label, address_line1, address_line2, address_line3, city, state_region, postal_code,
         country_code, phone, notes, status, sort_order, version, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?)`,
      [input.supplierId, address.label, address.addressLine1, address.addressLine2, address.addressLine3,
        address.city, address.stateRegion, address.postalCode, address.countryCode, address.phone, address.notes,
        await nextSortOrder(connection, "supplier_addresses", input.supplierId), nowMs, nowMs, input.actorId, input.actorId]
    );
    const addressId = Number(result.insertId);
    await this.#replacePurposes(connection, { supplierId: input.supplierId, addressId, purposes: address.purposes, actorId: input.actorId, nowMs, replace: false });
    const projected = await this.#project(connection, input.supplierId, addressId);
    await this.audit.record(connection, {
      actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.address.create",
      targetType: "address", targetId: addressId, supplierId: input.supplierId, targetLabel: address.label,
      detail: { after: { purposes: address.purposes } }, requestId: input.requestId, ip: input.ip
    });
    return projected;
  }

  async update(input) {
    const address = normalizeAddress(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#addressForUpdate(connection, input.supplierId, input.addressId);
      if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "地址已被其他人修改，請重新載入");
      if (current.status !== "active") throw supplierConflict("SUPPLIER_ADDRESS_INACTIVE", "已停用地址不可修改");
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE supplier_addresses SET label = ?, address_line1 = ?, address_line2 = ?, address_line3 = ?,
          city = ?, state_region = ?, postal_code = ?, country_code = ?, phone = ?, notes = ?,
          version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND supplier_id = ? AND version = ?`,
        [address.label, address.addressLine1, address.addressLine2, address.addressLine3, address.city,
          address.stateRegion, address.postalCode, address.countryCode, address.phone, address.notes,
          nowMs, input.actorId, input.addressId, input.supplierId, input.version]
      );
      // 鎖住讀：其他請求可能喺我哋等 Supplier 鎖嗰陣改過用途；普通 SELECT 會讀到舊 snapshot（REV-099 F-2）。
      const [beforePurposes] = await connection.query(
        "SELECT purpose_code, is_primary FROM supplier_address_purposes WHERE address_id = ? AND supplier_id = ? ORDER BY purpose_code FOR UPDATE", [input.addressId, input.supplierId]);
      await this.#replacePurposes(connection, { supplierId: input.supplierId, addressId: input.addressId, purposes: address.purposes, actorId: input.actorId, nowMs, replace: true });
      const projected = await this.#project(connection, input.supplierId, input.addressId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.address.update",
        targetType: "address", targetId: input.addressId, supplierId: input.supplierId, targetLabel: address.label,
        // HD-112 A：只記錄改咗嘅欄位同用途嘅前後值。
        detail: changedFieldsDetail({
          label: current.label, addressLine1: current.address_line1, addressLine2: current.address_line2, addressLine3: current.address_line3,
          city: current.city, stateRegion: current.state_region, postalCode: current.postal_code, countryCode: current.country_code,
          phone: current.phone, notes: current.notes, purposes: purposeList(beforePurposes)
        }, {
          label: address.label, addressLine1: address.addressLine1, addressLine2: address.addressLine2, addressLine3: address.addressLine3,
          city: address.city, stateRegion: address.stateRegion, postalCode: address.postalCode, countryCode: address.countryCode,
          phone: address.phone, notes: address.notes, purposes: sortedPurposes(address.purposes)
        }), requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  async deactivate(input) {
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#addressForUpdate(connection, input.supplierId, input.addressId);
      if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "地址已被其他人修改，請重新載入");
      if (current.status !== "active") throw supplierConflict("SUPPLIER_ADDRESS_INACTIVE", "地址已停用");
      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE supplier_addresses SET status = 'inactive', version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND supplier_id = ? AND version = ?`,
        [nowMs, input.actorId, input.addressId, input.supplierId, input.version]
      );
      await connection.execute(
        "UPDATE supplier_address_purposes SET is_primary = 0, updated_at = ?, updated_by = ? WHERE address_id = ? AND supplier_id = ?",
        [nowMs, input.actorId, input.addressId, input.supplierId]
      );
      const projected = await this.#project(connection, input.supplierId, input.addressId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.address.deactivate",
        targetType: "address", targetId: input.addressId, supplierId: input.supplierId, targetLabel: current.label,
        detail: { before: { status: current.status }, after: { status: "inactive" } }, requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  /** 上移／下移：同相鄰嘅有效地址交換顯示次序（DEF-037、HD-136）。 */
  async move(input) {
    if (input.direction !== "up" && input.direction !== "down") {
      throw invalidSupplierInput("SUPPLIER_PARTY_MOVE_INVALID", "方向只可以係 up 或 down", { field: "direction" });
    }
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#addressForUpdate(connection, input.supplierId, input.addressId);
      if (Number(current.version) !== input.version) throw supplierConflict("VERSION_CONFLICT", "地址已被其他人修改，請重新載入");
      if (current.status !== "active") throw supplierConflict("SUPPLIER_ADDRESS_INACTIVE", "已停用地址不可調整次序");
      const order = await swapWithNeighbour(connection, "supplier_addresses", {
        supplierId: input.supplierId, current, direction: input.direction, actorId: input.actorId, nowMs: this.time.nowMs()
      });
      const projected = await this.#project(connection, input.supplierId, input.addressId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.address.reorder",
        targetType: "address", targetId: input.addressId, supplierId: input.supplierId, targetLabel: current.label,
        // 鄰居嘅次序都變咗：記喺 metadata（REV-118 L-3）。
        detail: { before: { sortOrder: order.before }, after: { sortOrder: order.after }, metadata: { swappedWith: order.neighbour } },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }
}
