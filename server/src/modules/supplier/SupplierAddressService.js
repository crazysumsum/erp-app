import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { invalidSupplierInput, supplierChildNotFound, supplierConflict, supplierNotFound } from "./supplierErrors.js";
import { toAddressResponse } from "./supplierProjections.js";

export const SUPPLIER_ADDRESS_PURPOSES = Object.freeze(["registered", "office", "ordering", "return", "remittance", "other"]);
const PURPOSE_SET = new Set(SUPPLIER_ADDRESS_PURPOSES);

function normalizeAddress(input) {
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
    label: String(input.label ?? "").trim(),
    addressLine1: String(input.addressLine1 ?? "").trim(),
    addressLine2: String(input.addressLine2 ?? "").trim(),
    addressLine3: String(input.addressLine3 ?? "").trim(),
    city: String(input.city ?? "").trim(),
    stateRegion: String(input.stateRegion ?? "").trim(),
    postalCode: String(input.postalCode ?? "").trim(),
    countryCode: countryCode || null,
    phone: String(input.phone ?? "").trim(),
    notes: String(input.notes ?? "").trim(),
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
    const address = normalizeAddress(input);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      await this.#supplierForUpdate(connection, input.supplierId);
      const nowMs = this.time.nowMs();
      const [result] = await connection.execute(
        `INSERT INTO supplier_addresses
          (supplier_id, label, address_line1, address_line2, address_line3, city, state_region, postal_code,
           country_code, phone, notes, status, version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?)`,
        [input.supplierId, address.label, address.addressLine1, address.addressLine2, address.addressLine3,
          address.city, address.stateRegion, address.postalCode, address.countryCode, address.phone, address.notes,
          nowMs, nowMs, input.actorId, input.actorId]
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
    });
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
      await this.#replacePurposes(connection, { supplierId: input.supplierId, addressId: input.addressId, purposes: address.purposes, actorId: input.actorId, nowMs, replace: true });
      const projected = await this.#project(connection, input.supplierId, input.addressId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "", action: "supplier.address.update",
        targetType: "address", targetId: input.addressId, supplierId: input.supplierId, targetLabel: address.label,
        detail: { changes: { purposes: address.purposes } }, requestId: input.requestId, ip: input.ip
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
}
