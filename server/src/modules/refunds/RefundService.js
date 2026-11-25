import { amountUnits, eventId, formatUnits, localDate, onlyFields, positiveId, reason, text } from "../ar/arCommand.js";
import { PAYMENT_METHODS } from "../ar/ArReceiptService.js";
import { confirmedRefundBalance, voidedRefundBalance } from "./refundBalance.js";
import { refundError } from "./refundErrors.js";
import { REFUND_KINDS } from "./refundTypes.js";

const MAX_VERSION = 4294967295;

function refundInput(parse, ...args) {
  try {
    return parse(...args);
  } catch (error) {
    if (error.code !== "AR_INPUT_INVALID") throw error;
    throw refundError("REFUND_INPUT_INVALID", error.publicDetails);
  }
}

function result(kind, row, action, voidReason) {
  const { id, refund_number: number, status, version, amount } = row;
  return {
    summary: { id: Number(id), number, status, version: Number(version), amount },
    audit: {
      action: `refund.${action}`, targetType: "REFUND", targetId: Number(id), label: number ?? "",
      [kind.partyKey]: Number(row[kind.party]), ...(voidReason ? { reason: voidReason } : {}),
      detail: { version: Number(version), amount, currencyCode: row.currency_code, creditNoteId: Number(row.credit_note_id) }
    }
  };
}

function requireConfirmedCredit(credit) {
  if (credit.status !== "CONFIRMED") throw refundError("REFUND_CREDIT_STATE_CONFLICT");
}

function assertRefundDate(time, nowMs, refundDate) {
  if (refundDate > time.fileDate(time.at(nowMs))) throw refundError("REFUND_INPUT_INVALID", { field: "refundDate" });
}

export class RefundService {
  constructor({ kind, commands, time, nextDocumentNumber, lockCreditNote, updateCreditNote, businessMaster }) {
    if (!Object.hasOwn(REFUND_KINDS, kind)) throw new TypeError("Unknown refund kind");
    Object.assign(this, { kind: REFUND_KINDS[kind], commands, time, nextDocumentNumber, lockCreditNote, updateCreditNote, businessMaster });
  }

  create({ claims, input, context }) {
    const body = refundInput(onlyFields, input, ["eventId", "creditNoteId", "refundDate", "amount", "paymentMethod", "reference", "notes"]);
    if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw refundError("REFUND_INPUT_INVALID", { field: "paymentMethod" });
    const request = {
      creditNoteId: refundInput(positiveId, body.creditNoteId, "creditNoteId"),
      refundDate: refundInput(localDate, body.refundDate, "refundDate"),
      amount: formatUnits(refundInput(amountUnits, body.amount, "amount")),
      paymentMethod: body.paymentMethod,
      reference: refundInput(text, body.reference ?? "", "reference", { maximum: 190 }),
      notes: refundInput(text, body.notes ?? "", "notes", { maximum: 2000, multiline: true })
    };
    return this.#run("CREATE_REFUND", 0, claims, body.eventId, request, context, async (tx, { actor, nowMs }) => {
      assertRefundDate(this.time, nowMs, request.refundDate);
      const credit = await this.#lockCredit(tx, request.creditNoteId);
      requireConfirmedCredit(credit);
      const amount = formatUnits(refundInput(amountUnits, request.amount, "amount", Number(credit.currency_decimal_places)));
      confirmedRefundBalance(credit, amount);
      await this.#lockCurrency(tx, credit);
      const row = {
        credit_note_id: request.creditNoteId, [this.kind.party]: credit[this.kind.party], currency_code: credit.currency_code,
        amount, refund_date: request.refundDate, payment_method: request.paymentMethod, reference: request.reference, notes: request.notes,
        created_by: actor.id, created_by_label: actor.username, created_at: nowMs, updated_at: nowMs
      };
      const [inserted] = await tx.query(`INSERT INTO ${this.kind.refund} SET ?`, [row]);
      return result(this.kind, { ...row, id: inserted.insertId, refund_number: null, status: "DRAFT", version: 1 }, "created");
    });
  }

  confirm(command) {
    return this.#transition(command, { commandType: "CONFIRM_REFUND", from: "DRAFT", action: "confirmed" },
      async (tx, { actor, nowMs }, credit, refund) => {
        requireConfirmedCredit(credit);
        assertRefundDate(this.time, nowMs, refund.refund_date);
        const amount = formatUnits(refundInput(amountUnits, String(refund.amount), "amount", Number(credit.currency_decimal_places)));
        await this.#changeCredit(tx, credit, confirmedRefundBalance(credit, amount), nowMs);
        const number = await this.nextDocumentNumber(tx, { documentType: "REFUND", time: this.time, nowMs });
        return { refund_number: number, status: "CONFIRMED", confirmed_by: actor.id, confirmed_by_label: actor.username, confirmed_at: nowMs };
      });
  }

  cancel(command) {
    return this.#transition(command, { commandType: "CANCEL_REFUND", from: "DRAFT", action: "cancelled" },
      async () => ({ status: "CANCELLED" }));
  }

  void(command) {
    return this.#transition(command, { commandType: "VOID_REFUND", from: "CONFIRMED", action: "voided", withReason: true },
      async (tx, { actor, nowMs }, credit, refund, request) => {
        requireConfirmedCredit(credit);
        await this.#changeCredit(tx, credit, voidedRefundBalance(credit, String(refund.amount)), nowMs);
        return { status: "VOID", void_reason: request.reason, voided_by: actor.id, voided_by_label: actor.username, voided_at: nowMs };
      });
  }

  #transition({ refundId, claims, input, context }, { commandType, from, action, withReason }, changesFor) {
    const id = refundInput(positiveId, refundId, "refundId");
    const body = refundInput(onlyFields, input, withReason ? ["eventId", "version", "reason"] : ["eventId", "version"]);
    const version = refundInput(positiveId, body.version, "version");
    if (version >= MAX_VERSION) throw refundError("REFUND_INPUT_INVALID", { field: "version" });
    const payload = { version, ...(withReason ? { reason: refundInput(reason, body.reason) } : {}) };
    return this.#run(commandType, id, claims, body.eventId, payload, context, async (tx, command) => {
      const [[route]] = await tx.query(`SELECT credit_note_id FROM ${this.kind.refund} WHERE id = ?`, [id]);
      if (!route) throw refundError("REFUND_NOT_FOUND");
      const credit = await this.#lockCredit(tx, Number(route.credit_note_id));
      const [[refund]] = await tx.query(
        `SELECT id, refund_number, credit_note_id, ${this.kind.party}, currency_code, amount, version, status,
                DATE_FORMAT(refund_date, '%Y-%m-%d') AS refund_date
           FROM ${this.kind.refund} WHERE id = ? FOR UPDATE`, [id]);
      if (!refund) throw refundError("REFUND_NOT_FOUND");
      if (Number(refund.version) !== version) throw refundError("VERSION_CONFLICT", { currentVersion: Number(refund.version) });
      if (refund.status !== from) throw refundError("REFUND_STATE_CONFLICT");
      if (String(refund.credit_note_id) !== String(credit.id) ||
          String(refund[this.kind.party]) !== String(credit[this.kind.party]) ||
          refund.currency_code !== credit.currency_code) throw refundError("REFUND_BALANCE_CONFLICT");

      await this.#lockCurrency(tx, credit);
      const changes = { ...await changesFor(tx, command, credit, refund, payload), version: version + 1, updated_at: command.nowMs };
      const [updated] = await tx.query(`UPDATE ${this.kind.refund} SET ? WHERE id = ? AND version = ?`, [changes, id, version]);
      if (updated.affectedRows !== 1) throw refundError("CONCURRENT_OPERATION");
      return result(this.kind, { ...refund, ...changes }, action, payload.reason);
    });
  }

  #run(commandType, targetId, claims, event, payload, context, work) {
    return this.commands.run({ claims, permission: this.kind.permission, targetType: "REFUND", commandType,
      targetId, eventId: refundInput(eventId, event), payload, context }, work);
  }

  async #lockCredit(tx, id) {
    const credit = this.lockCreditNote ? await this.lockCreditNote(tx, id) : (await tx.query(
      `SELECT id, ${this.kind.party}, currency_code, currency_decimal_places, status, version, available_amount, refunded_amount
         FROM ${this.kind.credit} WHERE id = ? FOR UPDATE`, [id]))[0][0];
    if (!credit) throw refundError("REFUND_CREDIT_NOT_FOUND");
    return credit;
  }

  async #lockCurrency(tx, credit) {
    await this.businessMaster?.assertCurrencyUsableInTransaction(tx, { code: credit.currency_code, purpose: "history" });
  }

  async #changeCredit(tx, credit, { availableAmount, refundedAmount }, nowMs) {
    if (this.updateCreditNote) {
      await this.updateCreditNote(tx, credit, { available_amount: availableAmount, refunded_amount: refundedAmount }, nowMs);
      return;
    }
    if (Number(credit.version) >= MAX_VERSION) throw refundError("REFUND_BALANCE_CONFLICT");
    const [updated] = await tx.execute(
      `UPDATE ${this.kind.credit} SET available_amount = ?, refunded_amount = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
      [availableAmount, refundedAmount, nowMs, Number(credit.id), Number(credit.version)]);
    if (updated.affectedRows !== 1) throw refundError("CONCURRENT_OPERATION");
  }
}
