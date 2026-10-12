<script>
export const page = { name: "inventory-adjustments", path: "/inventory/adjustments", title: "高風險庫存操作",
  requires: { permissions: ["inventory.view", "inventory.adjust"] }, menu: { group: "inventory", icon: "edit_note", order: 60 } };
</script>
<script setup>
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import AdjustmentForm from "@/components/inventory/AdjustmentForm.vue";
import InventoryHighRiskDialog from "@/components/inventory/InventoryHighRiskDialog.vue";
import inventory from "@/services/inventory.js";
const route = useRoute(), session = useSessionStore();
const actions = ["IN", "OUT", "STATUS_TRANSFER", "REVERSAL"];
const types = { IN: "ADJUSTMENT", OUT: "ADJUSTMENT", STATUS_TRANSFER: "STATUS_TRANSFER", REVERSAL: "REVERSAL" };
const labels = { IN: "調整入庫", OUT: "調整出庫", STATUS_TRANSFER: "狀態轉換", REVERSAL: "整組沖銷" };
const positive = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const actorId = computed(() => positive(session.user?.id) ? session.user.id : null);
const canView = computed(() => can(session, { permissions: ["inventory.view"] }));
const canAdjust = computed(() => !!actorId.value && can(session, { permissions: ["inventory.view", "inventory.adjust"] }));
const action = ref("IN"), movementId = ref(null), status = ref("IDLE"), busy = ref(false), modal = ref(false);
const recovery = shallowRef(null), preview = shallowRef(null), result = shallowRef(null), resolvedSource = shallowRef(null);
const movements = ref([]), stockFacts = ref([]), error = ref(""), storageError = ref(""), factsError = ref(""), routeError = ref("");
let intent = null, generation = 0, live = true, controller, confirmationTrigger = "inventory-adjustment-review";
const key = id => `inventory-high-risk:v1:${id}`;
const sameSource = (a, b) => a && b && ["module", "documentType", "documentId", "lineId", "eventId"].every(field => a[field] === b[field]);
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function parseRecord(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).every(field => ["source", "action", "movementId"].includes(field)) ||
    !actions.includes(value.action) || !value.source || typeof value.source !== "object" || Array.isArray(value.source) ||
    Object.keys(value.source).sort().join() !== ["documentId", "documentType", "eventId", "lineId", "module"].sort().join() ||
    value.source.module !== "INVENTORY" || value.source.documentType !== types[value.action] || value.source.lineId !== "" ||
    !uuid(value.source.documentId) || !uuid(value.source.eventId) || value.source.documentId === value.source.eventId ||
    (value.action === "REVERSAL" ? !positive(value.movementId) : Object.hasOwn(value, "movementId"))) throw new Error("復原識別格式無效；不可猜測或重新過帳，請人工核對。");
  return freeze(value);
}
function stored(id) { const raw = sessionStorage.getItem(key(id)); return raw === null ? null : parseRecord(raw); }
function failStorage(message) { storageError.value = message; notifyError(message); }
function saveRecord(owned) {
  try {
    const previous = stored(owned.actorId);
    if (previous && (!sameSource(previous.source, owned.record.source) || previous.action !== owned.record.action || previous.movementId !== owned.record.movementId)) throw new Error("既有未解決復原識別不能覆寫。");
    sessionStorage.setItem(key(owned.actorId), JSON.stringify(owned.record));
    recovery.value = owned.record; return true;
  } catch { failStorage("無法保存復原識別；已阻擋過帳。請核對儲存空間及既有未解決操作。"); return false; }
}
function removeRecord(record, id) {
  try {
    const current = stored(id);
    if (current && (!sameSource(current.source, record.source) || current.action !== record.action || current.movementId !== record.movementId)) throw new Error("識別已變更");
    if (current) sessionStorage.removeItem(key(id)); recovery.value = null; return true;
  } catch { failStorage("結果已確認，但無法清除原復原識別；請重試讀取，勿另行重送。"); return false; }
}
function active(own) { return live && own === generation; }
function resetActor() {
  generation++; controller?.abort(); intent = null; modal.value = false; preview.value = null; result.value = null; resolvedSource.value = null;
  movements.value = []; stockFacts.value = []; recovery.value = null; status.value = "IDLE"; busy.value = false; error.value = ""; storageError.value = ""; factsError.value = "";
  if (!actorId.value) return;
  try {
    recovery.value = stored(actorId.value);
    if (recovery.value) { status.value = "QUERY_ONLY"; if (canView.value) queryOriginal(); }
  } catch (cause) { failStorage(cause.message || "無法讀取復原識別，不能開始新過帳。"); }
}
function readRoute() {
  const query = route.query, id = typeof query.movementId === "string" && /^[1-9][0-9]*$/u.test(query.movementId) ? Number(query.movementId) : null;
  const selected = query.action ?? "IN";
  routeError.value = !Object.keys(query).every(field => ["action", "movementId"].includes(field)) || !actions.includes(selected) ||
    (selected === "REVERSAL" ? !positive(id) : query.movementId !== undefined) ? "操作連結無效；請從庫存異動頁或操作選擇器重新進入。" : "";
  if (!routeError.value) { action.value = selected; movementId.value = id; }
}
function review(value) {
  if (!canAdjust.value || busy.value || intent || recovery.value || storageError.value || routeError.value || value.action !== action.value ||
    (value.action === "REVERSAL" && value.movementId !== movementId.value)) return;
  const source = { module: "INVENTORY", documentType: types[value.action], documentId: crypto.randomUUID(), lineId: "", eventId: crypto.randomUUID() };
  const record = { source, action: value.action, ...(value.action === "REVERSAL" ? { movementId: value.movementId } : {}) };
  intent = { actorId: actorId.value, record: freeze(record), body: freeze(JSON.parse(JSON.stringify(value.body))), key: crypto.randomUUID(), unknown: false };
  preview.value = freeze(JSON.parse(JSON.stringify(value.preview))); status.value = "CONFIRM"; confirmationTrigger = "inventory-adjustment-review"; modal.value = true; error.value = "";
}
function closeConfirmation(value) {
  modal.value = value;
  if (!value && !busy.value && intent && !intent.unknown && !recovery.value) { intent = null; preview.value = null; status.value = "IDLE"; }
}
async function collect(read, filters, idField, signal) {
  const rows = [], ids = new Set(); let total;
  for (let page = 1; ; page++) {
    const response = await read({ ...filters, page, rowsPerPage: 100, signal });
    if (!Array.isArray(response?.rows) || !Number.isSafeInteger(response.rowsNumber) || response.rowsNumber < 0 || (total !== undefined && total !== response.rowsNumber)) throw new Error("異動清單不完整，請重新核對。");
    total = response.rowsNumber;
    for (const row of response.rows) { if (!positive(row[idField]) || ids.has(row[idField])) throw new Error("讀取識別重複或無效。"); ids.add(row[idField]); rows.push(row); }
    if (rows.length === total) return rows;
    if (!response.rows.length || rows.length > total) throw new Error("異動清單未完整讀取。");
  }
}
async function reloadFacts(operation, source, own, signal) {
  try {
    const rows = await collect(inventory.listMovements, { sourceModule: source.module, sourceDocumentType: source.documentType, sourceDocumentId: source.documentId }, "movementId", signal);
    const exact = row => row.operationId === operation.operationId && row.groupId === operation.resultId && sameSource(row.source, source);
    const selected = rows.filter(exact)[0]; if (!selected) throw new Error("已完成操作的精確異動尚未讀取，請重載結果。");
    const detail = await inventory.getMovement(selected.movementId, { signal });
    if (detail?.movement.movementId !== selected.movementId || !detail.groupLegs?.length || !detail.groupLegs.every(exact)) throw new Error("異動組與原操作不一致，不能使用其他組的結果。");
    const facts = [], identities = new Set();
    for (const leg of detail.groupLegs) {
      const identity = [leg.warehouse.warehouseId, leg.bin?.binId, leg.sku.skuId, leg.lot?.lotId ?? null, leg.stockStatus];
      const encoded = JSON.stringify(identity); if (identities.has(encoded)) continue; identities.add(encoded);
      const stocks = await collect(inventory.listStocks, { warehouseId: identity[0], binId: identity[1], skuId: identity[2], status: identity[4],
        ...(leg.lot?.number ? { lot: leg.lot.number } : {}) }, "balanceId", signal);
      const matches = row => JSON.stringify([row.warehouse.warehouseId, row.bin.binId, row.sku.skuId, row.lot?.lotId ?? null, row.stockStatus]) === encoded;
      const found = stocks.find(matches);
      if (!found) throw new Error("過帳已確認，但目前庫存尚未核對；請重載結果。");
      const fact = await inventory.getStock(found.balanceId, { signal });
      if (fact?.balanceId !== found.balanceId || !matches(fact)) throw new Error("目前庫存識別不一致，不能套用其他 Bucket 的事實。");
      facts.push(fact);
    }
    if (active(own)) { movements.value = detail.groupLegs; stockFacts.value = facts; factsError.value = ""; }
  } catch (cause) { if (active(own)) factsError.value = cause.message || "已確認過帳，但目前事實未完成重載。"; }
}
async function lookupResult(record, own, signal) {
  const operation = await inventory.findOperationBySource(record.source, { signal });
  if (!active(own)) return null;
  if (operation === null) return null;
  if (!positive(operation?.operationId) || operation.resultType !== "MOVEMENT_GROUP" || typeof operation.resultId !== "string" || !operation.resultId ||
    !Number.isSafeInteger(operation.completedAt) || operation.completedAt < 0) throw new Error("結果尚未可確定，保留原識別等待核對。");
  result.value = operation; resolvedSource.value = record.source; status.value = "RESOLVED"; modal.value = false; error.value = "";
  removeRecord(record, actorId.value); intent = null; preview.value = null; notifySuccess("已確認原操作過帳，正在重載目前事實。");
  await reloadFacts(operation, record.source, own, signal); return operation;
}
async function queryOriginal() {
  if (busy.value || !canView.value) return;
  const record = recovery.value; if (!record) return;
  const own = generation; busy.value = true; controller = new AbortController(); error.value = "";
  try { await lookupResult(record, own, controller.signal); }
  catch { if (active(own)) error.value = "原結果查詢未完成；保留識別，不代表失敗或回滾，請稍後再查詢。"; }
  finally { if (active(own)) busy.value = false; }
}
async function retryOriginal() {
  if (busy.value || !canAdjust.value || !intent?.unknown || intent.actorId !== actorId.value || storageError.value) return;
  const own = generation; busy.value = true; controller = new AbortController(); error.value = "";
  try { const found = await lookupResult(intent.record, own, controller.signal); if (active(own) && !found && intent) { confirmationTrigger = "inventory-retry-intent"; modal.value = true; } }
  catch { if (active(own)) error.value = "查詢失敗，這次不重送；請先完成原結果查詢。"; }
  finally { if (active(own)) busy.value = false; }
}
async function submit(password) {
  const owned = intent, own = generation;
  if (!owned || !canAdjust.value || owned.actorId !== actorId.value || busy.value || storageError.value) return;
  busy.value = true; modal.value = false; controller = new AbortController(); error.value = ""; let sent = false, posted = false;
  try {
    if (owned.unknown && await lookupResult(owned.record, own, controller.signal)) return;
    if (!active(own) || !canAdjust.value || actorId.value !== owned.actorId || !saveRecord(owned)) return;
    sent = true; status.value = "SUBMITTING";
    const payload = { ...owned.body, source: owned.record.source, idempotencyKey: owned.key, password };
    if (owned.record.action === "REVERSAL") await inventory.reverseMovement(owned.record.movementId, payload, { signal: controller.signal });
    else if (owned.record.action === "STATUS_TRANSFER") await inventory.postStatusTransfer(payload, { signal: controller.signal });
    else await inventory.postAdjustment(payload, { signal: controller.signal });
    if (!active(own)) return;
    posted = true; owned.unknown = true; status.value = "UNKNOWN";
    await lookupResult(owned.record, own, controller.signal);
  } catch (cause) {
    if (!active(own)) return;
    const definitive = sent && cause.status >= 400 && cause.status < 500 && !/IN_PROGRESS/u.test(cause.code || "");
    if (definitive && !owned.unknown) { status.value = "REJECTED"; error.value = `${cause.message || '過帳遭拒'}。未自動重送；請核對原結果再重新準備。`; }
    else { if (sent) owned.unknown = true; status.value = owned.unknown ? "UNKNOWN" : "CONFIRM"; error.value = "結果未可確定；保留原意圖，請查詢原結果。未自動重送或建立新事件。"; }
    if (owned.unknown && sent && !posted) {
      try { await lookupResult(owned.record, own, controller.signal); }
      catch { if (active(own)) error.value = "原結果查詢未完成；保留原識別，不代表失敗或回滾。"; }
    }
    if (active(own) && error.value && status.value !== "RESOLVED") notifyError(error.value);
  } finally { password = null; if (active(own)) busy.value = false; }
}
async function prepareFresh() {
  if (busy.value || status.value !== "REJECTED" || !intent || intent.unknown || !canAdjust.value) return;
  const owned = intent, own = generation; busy.value = true; controller = new AbortController();
  try {
    if (await lookupResult(owned.record, own, controller.signal)) return;
    if (active(own) && removeRecord(owned.record, owned.actorId)) { intent = null; preview.value = null; status.value = "IDLE"; error.value = "請重新準備確認，以載入目前版本與效果；未自動過帳。"; }
  } catch { if (active(own)) error.value = "原結果查詢未完成，不能建立新的過帳意圖。"; }
  finally { if (active(own)) busy.value = false; }
}
function newOperation() { if (!busy.value && !recovery.value && !storageError.value && status.value === "RESOLVED") { status.value = "IDLE"; result.value = null; resolvedSource.value = null; movements.value = []; stockFacts.value = []; factsError.value = ""; } }
async function reloadResolved() {
  if (busy.value || !canView.value || !result.value) return;
  const own = generation; busy.value = true; controller = new AbortController();
  try { await reloadFacts(result.value, resolvedSource.value, own, controller.signal); }
  finally { if (active(own)) busy.value = false; }
}
async function copyReference() {
  try { await navigator.clipboard.writeText(JSON.stringify(recovery.value?.source ?? resolvedSource.value)); notifySuccess("已複製原操作來源識別。"); }
  catch { notifyError("無法自動複製；請選取畫面上的來源識別保存。"); }
}
function restoreFocus() { document.getElementById(result.value ? "posted-heading" : confirmationTrigger)?.focus(); }
watch(actorId, resetActor, { immediate: true });
watch(canAdjust, (allowed, previous) => { if (previous && !allowed) resetActor(); });
watch(() => route.query, () => { if (intent || recovery.value || busy.value) return; readRoute(); }, { immediate: true });
onUnmounted(() => { live = false; generation++; controller?.abort(); intent = null; modal.value = false; preview.value = null; });
</script>
<template>
  <div>
    <PageHeader subtitle="Base UOM 單次調整、狀態轉換及整組沖銷；每次嘗試需要目前密碼與設備簽章。">
      <template #actions><q-btn flat icon="history" label="異動追溯" to="/inventory/movements" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <q-banner v-if="!canAdjust" role="alert" class="bg-warning q-mb-md">需要 inventory.view 及 inventory.adjust；不能以 operation／FEFO 權限代替。</q-banner>
      <q-banner v-if="routeError || storageError || error" role="alert" class="bg-negative text-white q-mb-md">{{ routeError || storageError || error }}</q-banner>
      <q-btn v-if="storageError" flat label="重試讀取復原狀態" :disable="busy" @click="resetActor" />
      <div v-if="busy" role="status" aria-live="polite" class="q-mb-md">正在送出或查詢原操作…請勿另開新意圖。</div>
      <section v-if="recovery" aria-labelledby="recovery-heading" class="q-mb-md">
        <h2 id="recovery-heading" class="text-h6">{{ result ? '已確認結果；復原識別尚待清除' : status === 'REJECTED' ? '本次過帳遭拒' : '結果未知／等待核對' }}</h2>
        <p v-if="status === 'QUERY_ONLY'">重新載入後只可查詢；原 payload／key 已不在記憶體，不能重建重試。</p>
        <p>查詢不到不是失敗或回滾。保留原識別；未解決前不能另建事件。關閉分頁或清除儲存可能遺失識別，請複製保存並請管理人員人工核對。</p>
        <pre class="safe-reference">{{ JSON.stringify(recovery.source) }}</pre>
        <div class="row q-gutter-sm">
          <q-btn outline label="複製原來源識別" @click="copyReference" />
          <q-btn outline label="查詢原結果" :disable="busy || !canView" @click="queryOriginal" />
          <q-btn id="inventory-retry-intent" v-if="intent?.unknown && canAdjust" outline color="negative" label="重試原意圖" :disable="busy || !!storageError" @click="retryOriginal" />
          <q-btn v-if="status === 'REJECTED' && canAdjust" outline label="核對結果並重新準備" :disable="busy" @click="prepareFresh" />
        </div>
      </section>
      <section v-if="result" aria-labelledby="posted-heading">
        <h2 id="posted-heading" class="text-h6" tabindex="-1" aria-live="polite">已確認過帳 · Operation {{ result.operationId }}</h2>
        <p>原 Group {{ result.resultId }} · Base 數量 {{ result.resultSummary?.baseQuantity ?? '—' }} · legs {{ result.resultSummary?.lineCount ?? '—' }}</p>
        <pre class="safe-reference">{{ JSON.stringify(resolvedSource) }}</pre>
        <q-banner v-if="factsError" role="alert" class="bg-warning q-mb-md">{{ factsError }}</q-banner>
        <q-btn v-if="factsError" outline label="重載已確認結果" :disable="busy || !canView" @click="reloadResolved" />
        <div class="row q-gutter-sm q-mb-md"><q-btn v-for="movement in movements" :key="movement.movementId" outline
          :aria-label="`查看已過帳 Movement ${movement.movementId}`" :label="`Movement ${movement.movementId}`" :to="{ path: '/inventory/movements', query: { movementId: movement.movementId } }" /></div>
        <p v-for="row in stockFacts" :key="row.balanceId">目前 {{ row.sku.code }} · {{ row.warehouse.code }}/{{ row.bin.code }} · {{ row.lot?.number || '無批次' }} · {{ row.stockStatus }} · On Hand {{ row.onHand }} · Allocated {{ row.allocated }} · Free {{ row.bucketFree }} · v{{ row.version }}</p>
        <q-btn v-if="canAdjust" color="primary" label="開始新操作" :disable="busy || !!recovery || !!storageError" @click="newOperation" />
      </section>
      <template v-if="canAdjust && status !== 'QUERY_ONLY' && !result && !routeError">
        <q-select class="q-mb-md" v-model="action" :options="actions.map(value => ({ value, label: labels[value] }))" emit-value map-options outlined label="操作"
          :disable="busy || !!intent || !!recovery || !!storageError" />
        <AdjustmentForm :key="actorId" :action="action" :movement-id="movementId" :disabled="busy || !!intent || !!recovery || !!storageError" @review="review" />
        <q-btn v-if="status === 'CONFIRM' && !modal && !recovery" outline label="返回表單" :disable="busy" @click="closeConfirmation(false)" />
      </template>
    </div>
    <InventoryHighRiskDialog :model-value="modal" :execute="submit" :busy="busy" :disabled="!canAdjust || !!storageError" :title="`${labels[action]}：確認目前事實及整組效果`" @update:model-value="closeConfirmation" @hidden="restoreFocus">
      <template v-if="preview">
        <p>原因：{{ preview.reasonCategory || '—' }} · {{ preview.reasonText }}</p>
        <ul class="review-legs"><li v-for="(leg, index) in preview.legs" :key="index">
          {{ leg.bucket.sku.code }} · {{ leg.bucket.sku.name }} · {{ leg.bucket.warehouse.code }}/{{ leg.bucket.bin.code }} · {{ leg.bucket.lot?.number || '無批次' }} · {{ leg.bucket.lot?.expiryDate || '無效期' }} · {{ leg.bucket.stockStatus }}
          <br>{{ leg.direction }} {{ leg.quantity }} {{ leg.bucket.baseUom.uomCode }} · On Hand {{ leg.bucket.onHand }} → 預計 {{ leg.projected }} · Allocated {{ leg.bucket.allocated }} · Free {{ leg.bucket.bucketFree }} · 目前 v{{ leg.bucket.version ?? '不存在' }}
        </li></ul>
        <p v-for="row in preview.summaries" :key="`${row.warehouse}:${row.sku}`">{{ row.warehouse }}/{{ row.sku }} · Reserved {{ row.reserved }} · 未覆蓋 {{ row.uncoveredReserved }} · Eligible {{ row.eligibleOnHand }} · ATP {{ row.atp }}</p>
        <p>預覽不保證過帳；後端重查版本、鎖定、保障及效期。過期狀態轉換／沖銷不會授予銷售資格。</p>
      </template>
    </InventoryHighRiskDialog>
  </div>
</template>
<style scoped>
.safe-reference { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.review-legs { padding-inline-start: 24px; }
.review-legs li { margin-block: 8px; overflow-wrap: anywhere; }
</style>
