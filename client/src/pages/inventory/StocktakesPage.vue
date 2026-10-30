<script>
export const page = { name: "inventory-stocktakes", path: "/inventory/stocktakes", title: "盤點管理",
  requires: { permissions: ["inventory.view"] }, menu: { group: "inventory", icon: "fact_check", order: 70 } };
</script>
<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import StocktakeWizard from "@/components/inventory/StocktakeWizard.vue";
import StocktakeScopeForm from "@/components/inventory/StocktakeScopeForm.vue";
import { createStocktakeIntent, createStocktakeTable, readStocktakeUrl, stocktakeError } from "@/components/inventory/stocktakeIntent.js";
import inventory from "@/services/inventory.js";
const session = useSessionStore(), route = useRoute(), router = useRouter();
const actor = computed(() => session.user?.id ?? null), view = computed(() => can(session, { permissions: ["inventory.view"] }));
const operate = computed(() => can(session, { permissions: ["inventory.view", "inventory.operation"] }));
const adjust = computed(() => can(session, { permissions: ["inventory.view", "inventory.adjust"] }));
const ownerActor = ref(null), generation = ref(0), manager = shallowRef(null), query = ref({}), routeError = ref(""), error = ref("");
const wizard = ref(null), scope = ref(null), draft = ref(false), draftDirty = ref(false), active = computed(() => view.value && actor.value === ownerActor.value);
const state = computed(() => manager.value?.state ?? { status: "IDLE", record: null, busy: false });
const blocked = computed(() => !!state.value.record || state.value.status === "BLOCKED" || state.value.busy);
let alive = true, controller;
const columns = [{ name: "number", label: "單號", field: "number", align: "left" }, { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "warehouseId", label: "倉庫", field: "warehouseId", align: "left" }, { name: "actions", label: "詳情", field: "id", align: "right" }];
const table = createStocktakeTable({ active: () => active.value && !routeError.value && !blocked.value && !draft.value,
  read: params => inventory.listStocktakes({ ...params, ...Object.fromEntries(["warehouseId", "binId", "status", "dateFrom", "dateTo"].filter(key => query.value[key]).map(key => [key, query.value[key]])) }),
  onCommit: (_, pagination) => { if ((query.value.page !== undefined || pagination.page !== 1) && query.value.page !== pagination.page) replaceRead({ ...query.value, page: pagination.page }); } });
const listing = table.instance;
const methods = { create: "createStocktake", update: "updateStocktake", start: "startStocktake", count: "saveStocktakeCounts", add_line: "addStocktakeLine",
  ready: "readyStocktake", post: "postStocktake", cancel: "cancelStocktake" };
function permitted(action) { return active.value && (action === "post" ? adjust.value : operate.value); }
function executor(action, parent) {
  const own = generation.value, signal = controller.signal;
  return payload => {
    if (own !== generation.value || !permitted(action)) throw Object.assign(new Error("沒有權限"), { code: "Forbidden" });
    return action === "create" ? inventory[methods[action]](payload, { signal }) : inventory[methods[action]](parent, payload, { signal });
  };
}
async function command(action, parent, body, password) {
  if (!permitted(action) || blocked.value) throw Object.assign(new Error("原操作仍待核對"), { code: "Forbidden" });
  const owned = manager.value; owned.prepare(action, parent, body); error.value = "";
  return owned.send(executor(action, parent), password);
}
function resetAuthority() {
  generation.value++; controller?.abort(); controller = new AbortController(); table.dispose(); wizard.value?.clear();
  manager.value?.dispose(); manager.value = null; draft.value = false; draftDirty.value = false; error.value = ""; ownerActor.value = actor.value;
  if (!active.value || !alive) return;
  const own = generation.value;
  let storage;
  try { storage = window.sessionStorage; } catch { storage = { getItem: () => { throw new Error("儲存不可用"); } }; }
  manager.value = createStocktakeIntent({ actorId: actor.value, storage, active: () => alive && active.value && own === generation.value,
    lookup: source => inventory.findOperationBySource(source, { signal: controller.signal }) });
  readRoute();
}
function readRoute() {
  try { query.value = readStocktakeUrl(route.query); routeError.value = ""; table.refresh({ page: query.value.page ?? 1, rowsPerPage: 20 }); }
  catch (cause) { query.value = {}; routeError.value = cause.message; table.dispose(); }
}
function canLeave() {
  if (!active.value) { wizard.value?.clear(); return true; }
  if (blocked.value) { error.value = "原操作仍待核對，不能離開或建立新意圖；必要的登入／權限離開不受阻擋。"; return false; }
  if (draft.value && !scope.value?.canDiscard()) return false;
  return wizard.value?.canDiscard() ?? true;
}
function replaceRead(value) { router.replace({ query: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)])) }); }
async function selected(id) { if (canLeave()) await router.push({ query: { ...route.query, id: String(id) } }); }
const selectionAction = (id, tableKey, own) => () => {
  if (own === generation.value && tableKey === listing.value?.key && active.value) return selected(id);
};
function newDraft() { if (!canLeave() || !operate.value) return; table.suspend(); draft.value = true; draftDirty.value = false; }
function closeDraft(confirmed = false) { if (confirmed || scope.value?.canDiscard()) { draft.value = false; draftDirty.value = false; table.resume(); } }
async function draftSaved(receipt) { if (!active.value) return; draft.value = false; draftDirty.value = false; await selected(receipt.id); table.resume(); }
async function queryOriginal() {
  const owned = manager.value, own = generation.value, record = owned.state.record, target = wizard.value; error.value = "";
  try { if (await owned.query() && own === generation.value) {
    if (record.action === "create") { draft.value = false; draftDirty.value = false; await selected(owned.state.receipt.id); }
    else await target?.recovered(owned.state.receipt);
    if (own === generation.value) table.resume();
  } }
  catch (cause) { if (own === generation.value) error.value = stocktakeError(cause).message; }
}
async function retryOriginal(password) {
  const owned = manager.value, own = generation.value, record = owned.state.record;
  if (!record || !permitted(record.action)) return;
  error.value = "";
  try { const receipt = await owned.retry(executor(record.action, record.parentStocktakeId), password);
    if (own === generation.value && receipt) {
      if (record.action === "create") { draft.value = false; draftDirty.value = false; await selected(receipt.id); }
      else await wizard.value?.recovered(receipt);
      if (own === generation.value) table.resume();
    } }
  catch (cause) { if (own === generation.value) error.value = stocktakeError(cause).message; }
}
async function reprepare() {
  const owned = manager.value, own = generation.value, target = wizard.value, form = scope.value;
  try { await owned.reprepare(() => target ? target.reload() : form ? form.refreshCurrent() : false); if (own === generation.value) table.resume(); }
  catch (cause) { if (own === generation.value) error.value = stocktakeError(cause).message; }
}
async function copyReference() { try { await navigator.clipboard.writeText(JSON.stringify(state.value.record)); } catch { error.value = "無法複製；請人工記下畫面上的來源識別。"; } }
function beforeUnload(event) { if (active.value && (blocked.value || draftDirty.value || wizard.value?.hasChanges())) { event.preventDefault(); event.returnValue = ""; } }
onBeforeRouteLeave(canLeave); onBeforeRouteUpdate(canLeave);
watch([actor, view, operate, adjust], resetAuthority, { immediate: true, flush: "sync" });
watch(() => route.query, () => { if (active.value && !blocked.value) readRoute(); });
watch(blocked, value => { if (value) table.suspend(); else table.resume(); });
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onUnmounted(() => { alive = false; generation.value++; controller?.abort(); manager.value?.dispose(); table.dispose(); window.removeEventListener("beforeunload", beforeUnload); });
</script>
<template>
  <div v-if="active">
    <PageHeader subtitle="選範圍 → Start → 點算 → Review／Post；庫存與鎖的狀態以伺服器為準。" />
    <div class="q-pa-md stocktake-page">
      <q-banner v-if="routeError || error" role="alert" class="bg-negative text-white q-mb-md">{{ routeError || error }}</q-banner>
      <section v-if="state.record || state.status === 'BLOCKED'" class="q-mb-md" aria-label="原操作復原">
        <h2 class="text-h6">原操作 {{ state.status }}／等待核對</h2>
        <p>未知不代表回滾或已解鎖。刷新後只能查詢，不能重建提交；可能需要人工核對，關閉分頁或清除儲存會遺失參考。</p>
        <pre v-if="state.record" class="safe-reference">{{ JSON.stringify(state.record) }}</pre>
        <q-btn v-if="state.record" outline label="查詢原結果" :disable="state.busy" @click="queryOriginal" />
        <q-btn v-if="state.record" flat label="複製來源識別" @click="copyReference" />
        <q-btn v-if="['UNKNOWN', 'REJECTED'].includes(state.status) && !['post', 'cancel'].includes(state.record?.action)" outline label="明確重試原提交" :disable="state.busy" @click="retryOriginal()" />
        <q-btn v-if="state.status === 'REJECTED'" flat label="查詢並重新準備被拒意圖" :disable="state.busy" @click="reprepare" />
      </section>
      <section v-if="state.receipt" aria-label="原操作歷史回執" class="q-mb-md"><h2 class="text-h6">原操作歷史回執（不是目前狀態）</h2>
        <p>Operation {{ state.receipt.operationId }} · {{ state.receipt.status }} · version {{ state.receipt.version }} · 行數 {{ state.receipt.rowCount }}</p>
      </section>
      <q-btn v-if="operate && !routeError" color="primary" label="新增盤點草稿" :disable="blocked || draft" @click="newDraft" />
      <DataTable v-if="listing && !draft && !routeError" :key="listing.key" :fetch="listing.fetch" :initial-pagination="listing.pagination" :columns="columns" class="q-mt-md">
        <template #body-cell-number="cell"><q-td :props="cell"><EllipsisCell :text="cell.row.number" /></q-td></template>
        <template #body-cell-actions="cell"><q-td :props="cell"><q-btn flat color="primary" label="開啟盤點" :onClick="selectionAction(cell.row.id, listing.key, generation)" /></q-td></template>
      </DataTable>
      <StocktakeWizard v-if="query.id && !routeError && !draft" :key="`${generation}:${query.id}`" ref="wizard" :id="query.id" :read-query="query"
        :operate="operate" :adjust="adjust" :blocked="blocked" :command="command" :intent-state="state" :retry="retryOriginal" :query-original="queryOriginal" :reprepare="reprepare" />
      <q-dialog :model-value="draft" persistent @update:model-value="closeDraft">
        <q-card class="stocktake-dialog">
          <section v-if="state.record" class="q-pa-md" aria-label="草稿原操作復原">
            <p>原結果 {{ state.status }}；保留原內容，不自動重送。</p>
            <q-btn outline label="查詢原結果" :disable="state.busy" @click="queryOriginal" />
            <q-btn v-if="['UNKNOWN', 'REJECTED'].includes(state.status)" outline label="明確重試原提交" :disable="state.busy" @click="retryOriginal()" />
            <q-btn v-if="state.status === 'REJECTED'" flat label="查詢並重新準備被拒意圖" :disable="state.busy" @click="reprepare" />
          </section>
          <StocktakeScopeForm v-if="draft" ref="scope" :submit="body => command('create', null, body)" :disabled="blocked"
            @dirty="draftDirty = true" @close="closeDraft(true)" @saved="draftSaved" />
        </q-card>
      </q-dialog>
    </div>
  </div>
  <div v-else role="status">盤點資料已清除；請登入或核對目前權限。</div>
</template>
<style scoped>
.stocktake-page { min-width: 0; }
.stocktake-dialog { width: 760px; max-width: 100%; }
.safe-reference { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
