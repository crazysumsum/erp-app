<script>
export const page = {
  name: "inventory-opening", path: "/inventory/opening", title: "期初庫存",
  requires: { permissions: ["inventory.view", "inventory.mgmt"] },
  menu: { group: "inventory", icon: "upload_file", order: 80 }
};
</script>

<script setup>
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import InventoryHighRiskDialog from "@/components/inventory/InventoryHighRiskDialog.vue";
import { can } from "@/framework/authorization/can.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import inventory from "@/services/inventory.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore(), route = useRoute(), router = useRouter();
const active = computed(() => can(session, page.requires));
const job = shallowRef(null), fileInput = ref(null), queryId = ref(""), reason = ref("");
const error = ref(""), busy = ref(false), dialogOpen = ref(false), needsLookup = ref(false);
const control = shallowRef(null), goLiveVersion = ref(""), goLiveReason = ref(""), closing = ref(false);
const labels = { READY: "可確認入帳", INVALID: "預檢有錯誤", COMPLETED: "已完成入帳", CANCELLED: "已取消" };
const issueLabels = {
  OPENING_CSV_TOO_MANY_ROWS: "最多 5,000 筆資料列",
  OPENING_CSV_TOO_LARGE: "檔案超過 10 MiB",
  OPENING_CSV_INVALID_HEADER: "CSV 欄位或順序不正確",
  OPENING_CSV_INVALID_UTF8: "請以 UTF-8 儲存 CSV",
  OPENING_CSV_MALFORMED: "CSV 引號或列格式不正確",
  OPENING_CSV_COLUMN_COUNT: "欄位數不正確",
  OPENING_CSV_INVALID_QUANTITY: "數量須為非負整數",
  OPENING_CSV_INVALID_FIELD: "欄位值不正確",
  OPENING_NO_POSITIVE_ROWS: "檔案至少要有一筆正數結存",
  OPENING_SKU_UNAVAILABLE: "SKU 不可用於庫存或沒有有效的基礎單位",
  OPENING_POSITION_OCCUPIED: "此庫存位置已有結存或異動",
  OPENING_DUPLICATE_BUCKET: "同檔有重複的庫存維度",
  BIN_WAREHOUSE_MISMATCH: "倉庫或所屬庫位不可用",
  LOT_REQUIRED: "SKU 必須提供批次號",
  EXPIRY_REQUIRED: "SKU 必須提供到期日",
  LOT_DATA_CONFLICT: "同一批次的到期日不一致"
};
const canConfirm = computed(() => active.value && job.value?.status === "READY" &&
  control.value?.status === "PRE_GO_LIVE" && !needsLookup.value);
const canGoLive = computed(() => active.value && control.value?.status === "PRE_GO_LIVE" &&
  safeId(goLiveVersion.value.trim()) && [...goLiveReason.value.trim()].length >= 5);
let controller = new AbortController();

function safeId(value) {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
}

async function run(work, { uncertain = false, controlOnly = false } = {}) {
  if (!active.value || busy.value) return;
  const current = controller.signal;
  busy.value = true;
  error.value = "";
  try {
    const result = await work(current);
    if (current.aborted) return;
    if (controlOnly) {
      control.value = result;
      return;
    }
    control.value = result.control;
    job.value = result;
    queryId.value = String(result.id);
    needsLookup.value = false;
    await router.replace({ query: { id: queryId.value } });
  } catch (cause) {
    if (current.aborted) return;
    if (controlOnly && uncertain && cause.code === "VERSION_CONFLICT") {
      control.value = null;
      goLiveVersion.value = "";
      error.value = "期初資料已變更，請重新讀取狀態並重新對帳簽核。";
    } else if (controlOnly && uncertain && (!cause.status || cause.status >= 500)) {
      control.value = null;
      goLiveVersion.value = "";
      error.value = "結案結果未確認。請先重新讀取結案狀態。";
    } else if (cause.code === "OPENING_CLOSED") {
      control.value = null;
      error.value = "期初匯入已關閉。請重新讀取結案狀態。";
    } else if (uncertain && (!cause.status || cause.status >= 500)) {
      needsLookup.value = true;
      error.value = "入帳結果未確認。請先按「查詢結果」核對原匯入。";
    } else {
      error.value = cause.message || "操作失敗，請重試。";
    }
  } finally {
    if (!current.aborted) busy.value = false;
  }
}

function readControl() {
  return run(signal => inventory.getOpeningControl({ signal }), { controlOnly: true });
}

function lookup() {
  const value = queryId.value.trim();
  if (!safeId(value)) {
    error.value = "請輸入有效的匯入編號。";
    return;
  }
  job.value = null;
  return run(signal => inventory.getOpening(value, { signal }));
}

function upload() {
  const file = fileInput.value?.files?.[0];
  if (!file || busy.value || control.value?.status !== "PRE_GO_LIVE") return;
  job.value = null;
  return run(signal => inventory.uploadOpening(file, { signal }));
}

async function confirm(password) {
  if (!canConfirm.value || busy.value || reason.value.trim().length < 5) return;
  const current = job.value;
  dialogOpen.value = false;
  const body = { eventId: crypto.randomUUID(), expectedVersion: current.version, reason: reason.value.trim(), password };
  await run(signal => inventory.confirmOpening(current.id, body, { signal }), { uncertain: true });
}

function review(goLive) {
  closing.value = goLive;
  dialogOpen.value = true;
}

async function confirmGoLive(password) {
  if (!canGoLive.value || busy.value) return;
  dialogOpen.value = false;
  const body = { eventId: crypto.randomUUID(), expectedVersion: Number(goLiveVersion.value.trim()),
    reason: goLiveReason.value.trim(), password };
  await run(signal => inventory.goLive(body, { signal }), { uncertain: true, controlOnly: true });
}

watch([() => session.user?.id, active], () => {
  controller.abort();
  controller = new AbortController();
  job.value = null;
  control.value = null;
  busy.value = false;
  error.value = "";
  dialogOpen.value = false;
  reason.value = "";
  goLiveVersion.value = "";
  goLiveReason.value = "";
  closing.value = false;
  needsLookup.value = false;
  queryId.value = safeId(route.query.id) ? route.query.id : "";
  if (fileInput.value) fileInput.value.value = "";
  if (active.value) {
    if (queryId.value) lookup();
    else readControl();
  }
}, { immediate: true, flush: "sync" });
onUnmounted(() => controller.abort());
</script>

<template>
  <div v-if="active">
    <PageHeader />
    <div class="q-px-md q-pb-md opening-page">
      <q-banner v-if="error" class="q-mb-md" role="alert">{{ error }}</q-banner>
      <p v-if="busy" role="status">處理中，請稍候。</p>
      <p v-if="control?.status === 'PRE_GO_LIVE'">尚未結案 · 目前對帳版本 {{ control.version }}</p>
      <p v-else-if="control?.status === 'LIVE'" role="status">庫存已上線，期初匯入已關閉。可查詢歷史結果。</p>
      <q-btn v-else flat label="重新讀取結案狀態" :disable="busy" @click="readControl" />
      <form
        v-if="control?.status === 'PRE_GO_LIVE'"
        method="post"
        aria-labelledby="opening-upload"
        class="q-mb-lg"
        @submit.prevent="upload"
      >
        <h2 id="opening-upload" class="text-subtitle1">上傳預檢</h2>
        <label for="opening-file" class="block">CSV 檔案（必填）</label>
        <input id="opening-file" ref="fileInput" name="file" type="file" accept=".csv,text/csv"
          required :disabled="busy" aria-describedby="opening-file-help">
        <p id="opening-file-help" class="text-caption">UTF-8 CSV，每檔最多 5,000 筆。上傳預檢後須另外確認入帳。</p>
        <q-btn label="上傳預檢" color="primary" type="submit" :disable="busy" />
      </form>

      <form v-if="control?.status === 'PRE_GO_LIVE'" method="post" aria-labelledby="opening-go-live"
        class="q-mb-lg" @submit.prevent="canGoLive && review(true)">
        <h2 id="opening-go-live" class="text-subtitle1">期初結案</h2>
        <label for="opening-go-live-version" class="block">已簽核的對帳版本（必填）</label>
        <input id="opening-go-live-version" v-model="goLiveVersion" type="text" inputmode="numeric"
          pattern="[1-9][0-9]{0,15}" required :disabled="busy">
        <label for="opening-go-live-reason" class="block">結案原因（必填）</label>
        <input id="opening-go-live-reason" v-model="goLiveReason" type="text" required minlength="5" maxlength="500"
          :disabled="busy">
        <q-btn class="q-ml-sm" label="核對並結案" color="negative" outline type="submit" :disable="busy || !canGoLive" />
      </form>

      <form method="get" aria-labelledby="opening-query" class="q-mb-lg" @submit.prevent="lookup">
        <h2 id="opening-query" class="text-subtitle1">查詢已保存結果</h2>
        <label for="opening-job-id" class="block">匯入編號</label>
        <input id="opening-job-id" v-model="queryId" name="id" type="text" inputmode="numeric"
          pattern="[1-9][0-9]{0,15}" required :disabled="busy">
        <q-btn class="q-ml-sm" label="查詢結果" type="submit" outline :disable="busy" />
      </form>

      <section v-if="job" aria-labelledby="opening-result">
        <h2 id="opening-result" class="text-subtitle1">匯入結果</h2>
        <p role="status">匯入 #{{ job.id }} · {{ job.status === "READY" && control?.status === "LIVE"
          ? "期初已結案，不可入帳" : labels[job.status] }} · {{ job.readyRows }} 筆正數資料</p>
        <p v-if="job.operationId">入帳操作編號 {{ job.operationId }}</p>
        <details v-if="job.skippedRows.length" class="q-mb-md">
          <summary>已略過 {{ job.skippedRows.length }} 筆零數量列</summary>
          <p class="opening-rows">{{ job.skippedRows.join("、") }}</p>
        </details>
        <ul v-if="job.errors.length">
          <li v-for="(issue, index) in job.errors" :key="index">
            第 {{ issue.row }} 列 · {{ issue.field }} · {{ Object.hasOwn(issueLabels, issue.code) ? issueLabels[issue.code] : issue.code }}
          </li>
        </ul>
        <form v-if="canConfirm" method="post" aria-labelledby="opening-review" @submit.prevent="review(false)">
          <h3 id="opening-review" class="text-subtitle1">確認入帳</h3>
          <label for="opening-reason" class="block">入帳原因（必填）</label>
          <input id="opening-reason" v-model="reason" name="reason" type="text" required minlength="5" maxlength="500"
            :disabled="busy">
          <q-btn class="q-ml-sm" label="核對並確認" color="primary" type="submit" :disable="busy" />
        </form>
      </section>

      <InventoryHighRiskDialog v-model="dialogOpen" aria-labelledby="inventory-confirm-title" :title="closing ? '確認期初結案' : '確認期初庫存整批入帳'"
        :confirm-label="closing ? '確認結案' : '確認過帳'" :busy="busy"
        :disabled="closing ? !canGoLive : !canConfirm || reason.trim().length < 5" :execute="closing ? confirmGoLive : confirm">
        <template v-if="closing">
          <p>結案將永久關閉期初上傳及入帳。後續差異請依授權庫存調整流程處理。</p>
          <p>已簽核的對帳版本 {{ goLiveVersion.trim() }}</p>
          <p>原因：{{ goLiveReason.trim() }}</p>
        </template>
        <template v-else>
          <p>匯入 #{{ job?.id }}（預檢版本 {{ job?.version }}）的 {{ job?.readyRows }} 筆資料將一起入帳。任一列失敗時整批回滾。</p>
          <p>原因：{{ reason.trim() }}</p>
        </template>
      </InventoryHighRiskDialog>
    </div>
  </div>
</template>

<style scoped>
.opening-page input { font: inherit; font-size: max(1rem, 1em); min-height: 48px; max-width: 100%; }
.opening-rows { overflow-wrap: anywhere; }
</style>
