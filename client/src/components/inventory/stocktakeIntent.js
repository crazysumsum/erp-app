import { shallowReactive, shallowRef } from "vue";
import { ERROR_CODE_MESSAGES } from "@/framework/http/errorMessages.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ACTION_STATUS = { create: "DRAFT", update: "DRAFT", start: "COUNTING", count: "COUNTING", add_line: "COUNTING",
  ready: "READY_TO_POST", post: "POSTED", cancel: "CANCELLED" };
const positive = value => Number.isSafeInteger(value) && value > 0;
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const fail = message => { throw new Error(message); };
function frozen(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
export function stocktakeError(error) {
  const known = typeof error?.code === "string" && Object.hasOwn(ERROR_CODE_MESSAGES, error.code);
  const safe = new Error(known ? ERROR_CODE_MESSAGES[error.code] : "無法完成操作；請核對原結果，未自動重送。");
  if (known) safe.code = error.code;
  if (Number.isSafeInteger(error?.status) && error.status >= 400 && error.status <= 599) safe.status = error.status;
  // Only messages from the existing translation whitelist may reach FormPanel.
  if (Array.isArray(error?.details)) {
    const messages = new Set(Object.values(ERROR_CODE_MESSAGES));
    const details = error.details.filter(row => plain(row) && row.location === "body" && typeof row.path === "string" &&
      /^\/[A-Za-z0-9_/]+$/u.test(row.path) && messages.has(row.message));
    if (details.length) safe.details = details.map(({ location, path, message }) => ({ location, path, message }));
  }
  return safe;
}
export function validStocktakeText(value, { required = false, bytes = 500, length = Infinity } = {}) {
  return typeof value === "string" && (!required || !!value.trim()) && !/\p{Cc}/u.test(value) &&
    [...value].length <= length && new TextEncoder().encode(value).length <= bytes;
}
export function stocktakeQuantity(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value))) return null;
  return Number(value);
}
export function readStocktakeUrl(query) {
  const output = {}, ids = ["id", "warehouseId", "binId", "skuId", "lotId", "page", "linePage", "scopePage"];
  const enums = { status: ["ALL", "DRAFT", "COUNTING", "READY_TO_POST", "POSTED", "CANCELLED"], stockStatus: ["ALL", "AVAILABLE", "QUARANTINED", "DAMAGED"],
    progress: ["ALL", "UNCOUNTED", "COUNTED", "NOT_FOUND"], variance: ["ALL", "GAIN", "LOSS", "ZERO"] };
  for (const [key, value] of Object.entries(query)) {
    if (typeof value !== "string") fail("盤點網址不正確；請從選單重新進入。");
    if (ids.includes(key)) {
      if (!/^[1-9][0-9]*$/u.test(value) || !positive(Number(value))) fail("盤點網址識別不正確。"); output[key] = Number(value);
    } else if (Object.hasOwn(enums, key)) {
      if (!enums[key].includes(value)) fail("盤點網址篩選不正確。"); output[key] = value;
    } else if (key === "q") {
      if (!validStocktakeText(value, { bytes: 760, length: 190 })) fail("盤點網址搜尋不正確。"); output[key] = value.trim();
    } else if (["dateFrom", "dateTo"].includes(key)) {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail("盤點網址日期不正確。"); output[key] = value;
    } else fail("盤點網址含不支援欄位；請從選單重新進入。");
  }
  if (output.dateFrom && output.dateTo && output.dateFrom > output.dateTo) fail("盤點網址日期範圍不正確。");
  return output;
}
function validRecord(record) {
  if (!plain(record) || typeof record.action !== "string" || !Object.hasOwn(ACTION_STATUS, record.action)) return false;
  const create = record.action === "create", source = record.source;
  return exact(record, create ? ["action", "source"] : ["action", "source", "parentStocktakeId"]) &&
    exact(source, ["module", "documentType", "documentId", "lineId", "eventId"]) && Object.values(source).every(value => typeof value === "string") && source.module === "INVENTORY" &&
    source.documentType === "STOCKTAKE" && source.lineId === "" && UUID.test(source.eventId) &&
    (create ? UUID.test(source.documentId) : positive(record.parentStocktakeId) && source.documentId === String(record.parentStocktakeId));
}
function receiptFor(value, record, original) {
  if (!plain(value) || Object.keys(value).some(key => !["id", "stocktakeId", "operationId", "status", "version", "rowCount", "movementGroupId"].includes(key)) ||
      !positive(value.id) || !positive(value.operationId) || !positive(value.version) || value.version > 4294967295 ||
      !Number.isSafeInteger(value.rowCount) || value.rowCount < 0 || value.status !== ACTION_STATUS[record.action] ||
      (Object.hasOwn(value, "movementGroupId") && (record.action !== "post" || (value.movementGroupId !== null &&
        (typeof value.movementGroupId !== "string" || !UUID.test(value.movementGroupId)))))) return false;
  if (record.action === "create" && (value.version !== 1 || value.rowCount < 1)) return false;
  if (["create", "update"].includes(record.action) && original && value.rowCount !== original.binIds.length) return false;
  if (record.action === "update" && value.rowCount < 1) return false;
  if (original?.expectedVersion !== undefined && value.version !== original.expectedVersion + 1) return false;
  if (record.action === "post" && (value.rowCount === 0 ? value.movementGroupId !== null : typeof value.movementGroupId !== "string")) return false;
  if (record.action === "add_line") return value.stocktakeId === record.parentStocktakeId && value.version === 1 && value.rowCount === 1;
  return !Object.hasOwn(value, "stocktakeId") && (record.action === "create" || value.id === record.parentStocktakeId) &&
    (record.action !== "count" || value.rowCount === 1);
}
function credentialFree(value) {
  if (Array.isArray(value)) return value.every(credentialFree);
  if (plain(value)) return Object.entries(value).every(([key, item]) => !/password|token|credential|proof|signature|nonce|source|idempotencyKey/iu.test(key) && credentialFree(item));
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isSafeInteger(value));
}
export function createStocktakeIntent({ actorId, storage, active, lookup }) {
  const key = `inventory-stocktake-recovery:v1:${actorId}`;
  const state = shallowReactive({ status: "IDLE", record: null, receipt: null, busy: false });
  let original = null, everUnknown = false, disposed = false;
  const current = () => !disposed && active();
  const stored = () => storage.getItem(key);
  const matches = () => stored() === JSON.stringify(state.record);
  try {
    if (!positive(actorId)) fail("登入身份不正確。");
    const raw = stored();
    if (raw !== null) {
      const record = JSON.parse(raw);
      if (!validRecord(record)) fail("復原識別不完整，請人工核對。");
      state.record = frozen(record); state.status = "QUERY_ONLY"; everUnknown = true;
    }
  } catch { state.status = "BLOCKED"; }
  function prepare(action, parentStocktakeId, body) {
    if (!current() || state.record || !["IDLE", "RESOLVED"].includes(state.status) || !Object.hasOwn(ACTION_STATUS, action) || !credentialFree(body))
      fail("原操作仍待核對，不能建立另一個寫入。");
    const source = { module: "INVENTORY", documentType: "STOCKTAKE", documentId: action === "create" ? crypto.randomUUID() : String(parentStocktakeId),
      lineId: "", eventId: crypto.randomUUID() };
    const record = { action, source, ...(action === "create" ? {} : { parentStocktakeId }) };
    if (!validRecord(record)) fail("盤點操作身份不正確。");
    const payload = frozen(JSON.parse(JSON.stringify({ ...body, source, idempotencyKey: crypto.randomUUID() })));
    try {
      if (stored() !== null) fail("已有待核對的操作。");
      storage.setItem(key, JSON.stringify(record));
      if (stored() !== JSON.stringify(record)) fail("無法保存復原識別。");
    } catch { state.status = "BLOCKED"; fail("無法安全保存復原識別；尚未送出操作。"); }
    original = payload; state.record = frozen(record); state.receipt = null; state.status = "PREPARED"; everUnknown = false;
  }
  function resolved(receipt) {
    if (!current()) return;
    if (!receiptFor(receipt, state.record, original)) { everUnknown = true; state.status = "UNKNOWN"; fail("原回執身份不一致，結果未知。"); }
    state.receipt = frozen({ ...receipt }); state.status = "RESOLVED"; original = null;
    try { if (!matches()) fail("復原識別已變更。"); storage.removeItem(key); state.record = null; }
    catch { state.status = "BLOCKED"; fail("結果已確認，但復原識別未能安全清除。"); }
  }
  async function query() {
    if (!current() || !state.record || state.busy) fail("目前不能查詢原結果。");
    state.busy = true;
    try {
      const response = await lookup(state.record.source);
      if (!current()) return false;
      if (response === null) { if (state.status !== "REJECTED" || everUnknown) { everUnknown = true; state.status = original ? "UNKNOWN" : "QUERY_ONLY"; } return false; }
      const parent = state.record.action === "add_line" ? response?.resultSummary?.stocktakeId : response?.resultSummary?.id;
      if (!plain(response) || response.resultType !== "STOCKTAKE" || !positive(parent) || typeof response.resultId !== "string" || response.resultId !== String(parent) ||
          !positive(response.operationId) || response.operationId !== response.resultSummary?.operationId || !positive(response.completedAt))
        fail("原結果未能確認。");
      resolved(response.resultSummary); return true;
    } catch (error) { if (current() && state.status !== "BLOCKED") { everUnknown = true; state.status = original ? "UNKNOWN" : "QUERY_ONLY"; } throw stocktakeError(error); }
    finally { if (current()) state.busy = false; }
  }
  async function send(execute, password) {
    if (!current() || !original || state.busy || !["PREPARED", "UNKNOWN", "REJECTED"].includes(state.status)) fail("只能查詢原結果，不能重建提交。");
    try { if (!matches()) fail("復原識別已變更。"); } catch { state.status = "BLOCKED"; fail("無法核對復原識別，尚未送出。"); }
    if (["post", "cancel"].includes(state.record.action) && (!password || password.length > 1024)) fail("每次嘗試必須重新輸入密碼。");
    state.busy = true; state.status = "SENDING";
    try {
      const response = await execute(password ? { ...original, password } : original);
      if (current()) resolved(response);
      return current() ? state.receipt : null;
    } catch (error) {
      if (current() && state.status !== "BLOCKED") {
        const rejected = !everUnknown && error.status >= 400 && error.status < 500 && error.status !== 408 &&
          !["CONCURRENT_OPERATION", "IDEMPOTENCY_IN_PROGRESS"].includes(error.code);
        everUnknown ||= !rejected; state.status = rejected ? "REJECTED" : "UNKNOWN";
      }
      throw stocktakeError(error);
    } finally { password = null; if (current()) state.busy = false; }
  }
  async function retry(execute, password) { if (await query()) return state.receipt; if (!current()) return null; return send(execute, password); }
  async function reprepare(refresh) {
    if (everUnknown || state.status !== "REJECTED") fail("未知結果不能捨棄或建立新意圖。");
    if (await query()) return;
    if (!current() || everUnknown || state.status !== "REJECTED") fail("原結果未能確認。");
    state.busy = true;
    try {
      if (await refresh() !== true) fail("目前狀態未能確認，原意圖與識別仍保留。");
      if (!current() || everUnknown || state.status !== "REJECTED" || !matches()) fail("身份已變更。");
      storage.removeItem(key); original = null; state.record = null; state.status = "IDLE";
    } finally { if (current()) state.busy = false; }
  }
  function dispose() { disposed = true; original = null; state.record = null; state.receipt = null; state.status = "IDLE"; state.busy = false; }
  return { state, prepare, query, send, retry, reprepare, dispose };
}

// Shared DataTable is intentionally unchanged; late work can only settle on a retired instance.
export function createStocktakeTable({ read, active, onCommit = () => {}, onRetire = () => {}, initial = { page: 1, rowsPerPage: 20 } }) {
  const instance = shallowRef(null);
  let generation = 0, suspended = false, committed = { ...initial }, controller;
  const aborted = () => new DOMException("已取消舊頁讀取", "AbortError");
  function retire() { generation++; controller?.abort(); controller = null; instance.value = null; onRetire(); }
  function refresh(request = committed) {
    retire(); if (suspended || !active()) return;
    const captured = generation, pagination = Object.freeze({ page: request.page, rowsPerPage: request.rowsPerPage, rowsNumber: 0, sortBy: null, descending: false });
    controller = new AbortController(); const signal = controller.signal; let called = false;
    const fetch = async requested => {
      if (captured !== generation || suspended || !active()) throw aborted();
      if (called) { refresh(requested); throw aborted(); }
      called = true;
      try {
        const response = await read({ page: pagination.page, rowsPerPage: pagination.rowsPerPage, signal });
        if (captured !== generation || suspended || !active()) throw aborted();
        committed = { page: pagination.page, rowsPerPage: pagination.rowsPerPage }; onCommit(response, committed, captured);
        return response;
      } catch (error) { throw captured === generation && active() ? stocktakeError(error) : aborted(); }
    };
    instance.value = { key: captured, pagination, fetch };
  }
  function suspend() { suspended = true; retire(); }
  function resume() { suspended = false; refresh(); }
  return { instance, refresh, suspend, resume, dispose: retire, committed: () => ({ ...committed }) };
}
