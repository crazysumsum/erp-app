import { createHash, timingSafeEqual } from "node:crypto";

import { businessMasterConflict, businessMasterUnavailable } from "./businessMasterErrors.js";

const VALID_STATUSES = new Set(["READY", "NOT_INSTALLED"]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export class BusinessMasterImpactRegistry {
  constructor({ checkers = [], requiredCheckerIds, time, timeoutMs = 2_000, tokenTtlMs = 300_000 } = {}) {
    if (!time || typeof time.nowMs !== "function") throw new TypeError("BusinessMasterImpactRegistry requires time");
    this.time = time;
    this.timeoutMs = timeoutMs;
    this.tokenTtlMs = tokenTtlMs;
    this.checkers = new Map(checkers.map((checker) => [checker.id, checker]));
    this.requiredCheckerIds = [...(requiredCheckerIds ?? this.checkers.keys())].sort();
  }

  async #runChecker(id, subject) {
    const checker = this.checkers.get(id);
    if (!checker) throw businessMasterUnavailable("IMPACT_CHECK_UNAVAILABLE", "影響檢查器未就緒", { checkerId: id });
    let timeout;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("checker timeout")), this.timeoutMs);
        timeout.unref?.();
      });
      const result = await Promise.race([checker.check(subject), timeoutPromise]);
      if (!VALID_STATUSES.has(result?.status)) throw new Error("unknown checker status");
      const counts = [result.activeDefaultCount, result.openUseCount, result.historicalCount];
      if (counts.some((count) => !Number.isInteger(count) || count < 0) || typeof result.watermark !== "string" || !result.watermark) {
        throw new Error("malformed checker result");
      }
      if (result.status === "NOT_INSTALLED" && counts.some((count) => count !== 0)) {
        throw new Error("NOT_INSTALLED checker returned references");
      }
      return { checkerId: id, status: result.status, activeDefaultCount: counts[0], openUseCount: counts[1], historicalCount: counts[2], watermark: result.watermark };
    } catch (error) {
      throw businessMasterUnavailable("IMPACT_CHECK_UNAVAILABLE", "無法完成影響檢查，操作已被阻止", { checkerId: id });
    } finally {
      clearTimeout(timeout);
    }
  }

  async #results(subject) {
    const results = [];
    for (const id of this.requiredCheckerIds) results.push(await this.#runChecker(id, subject));
    return results;
  }

  #payload(subject, results, issuedAt) {
    return canonicalize({
      actorId: Number(subject.actorId),
      entityType: subject.entityType,
      entityKey: String(subject.entityKey),
      version: Number(subject.version),
      operation: subject.operation,
      proposedChange: subject.proposedChange ?? {},
      issuedAt,
      results
    });
  }

  #encode(payload) {
    const encoded = Buffer.from(canonicalJson(payload)).toString("base64url");
    return `${encoded}.${digest(encoded)}`;
  }

  #decode(token) {
    const [encoded, suppliedDigest, extra] = String(token ?? "").split(".");
    if (!encoded || !suppliedDigest || extra || !equalDigest(digest(encoded), suppliedDigest)) {
      throw businessMasterConflict("IMPACT_TOKEN_INVALID", "影響確認資料不正確，請重新預覽");
    }
    try {
      return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw businessMasterConflict("IMPACT_TOKEN_INVALID", "影響確認資料不正確，請重新預覽");
    }
  }

  async preview(subject) {
    const results = await this.#results(subject);
    const issuedAt = this.time.nowMs();
    const payload = this.#payload(subject, results, issuedAt);
    return { ...payload, expiresAt: issuedAt + this.tokenTtlMs, impactToken: this.#encode(payload) };
  }

  async confirm(subject) {
    const payload = this.#decode(subject.impactToken);
    const comparable = this.#payload(subject, payload.results, payload.issuedAt);
    if (canonicalJson(payload) !== canonicalJson(comparable)) {
      throw businessMasterConflict("IMPACT_TOKEN_INVALID", "影響確認資料與本次操作不符，請重新預覽");
    }
    if (!Number.isInteger(payload.issuedAt) || this.time.nowMs() - payload.issuedAt > this.tokenTtlMs || payload.issuedAt > this.time.nowMs()) {
      throw businessMasterConflict("IMPACT_TOKEN_EXPIRED", "影響預覽已過期，請重新預覽");
    }
    const currentResults = await this.#results(subject);
    if (canonicalJson(currentResults) !== canonicalJson(payload.results)) {
      throw businessMasterConflict("IMPACT_CHANGED", "引用情況已改變，請重新預覽");
    }
    return { results: currentResults, issuedAt: payload.issuedAt };
  }
}
