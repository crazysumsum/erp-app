<script>
export const page = {
  name: "supplier-imports",
  path: "/suppliers/imports",
  title: "供應商匯入",
  requires: { permissions: ["supplier.mgmt"] },
  menu: { group: "suppliers", icon: "upload_file", order: 60 }
};
</script>

<script setup>
/**
 * 供應商匯入（T46；設計 §7.8）：下載範本 → 上載／預檢 → 確認（草稿或啟用）→ 逐列結果。
 * 每個工作只有上載者睇到（HD-058）；詳情開住時用 `?job=` 記住，重新整理或者再入頁都唔會唔見個 job，
 * 亦唔會重送確認（確認只喺按掣時送）。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { confirm, promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useRequestAbort } from "@/framework/http/useRequestAbort.js";
import supplierApprovalService from "@/services/supplierApproval.js";
import supplierImportService from "@/services/supplierImport.js";
import { useSessionStore } from "@/stores/session.js";

const POLLABLE = new Set(["uploaded", "validating", "queued", "running"]);
const CANCELLABLE = new Set(["uploaded", "ready", "ready_with_errors", "queued"]);
const CONFIRMABLE = new Set(["ready", "ready_with_errors"]);
const STATUS_LABEL = Object.freeze({
  uploaded: "已上傳，等候預檢", validating: "預檢中", ready: "待確認", ready_with_errors: "待確認（有錯誤列）",
  queued: "已排入佇列", running: "執行中", completed: "已完成", completed_with_errors: "已完成（有失敗列）",
  failed: "失敗", cancelled: "已取消"
});
const STATUS_COLOR = Object.freeze({
  uploaded: "grey", validating: "blue", ready: "orange", ready_with_errors: "warning", queued: "blue-grey",
  running: "blue", completed: "positive", completed_with_errors: "warning", failed: "negative", cancelled: "grey"
});
const ROW_LABEL = Object.freeze({ valid: "有效", warning: "警告", invalid: "無效", applied: "已寫入", failed: "失敗", skipped: "略過" });
const MODE_LABEL = Object.freeze({ create_only: "只新增", upsert: "新增或更新" });
const OPERATION_LABEL = Object.freeze({ create: "新增", update: "更新" });

const session = useSessionStore();
const route = useRoute();
const router = useRouter();
const signal = useRequestAbort();
const table = ref(null);
const detailTable = ref(null);
const statusFilter = ref(null);
const showUpload = ref(false);
const uploadMode = ref("create_only");
const uploadFile = ref(null);
const busy = ref(false);
const showDetail = ref(false);
const detailId = ref(null);
const job = ref(null);
const rowStatus = ref(null);
const rowNumber = ref(null);
const activationMode = ref("draft");
const approvalRequired = ref(null);
const approverUserId = ref(null);
const approverOptions = ref([]);
let pollTimer = null;
let latestRowsRequest = null;
// 只接受正整數嘅 `?job=`：舊連結或者手改嘅 URL 唔好開一個 #NaN 嘅空 dialog（REV-073 L-3）。
const JOB_ID = /^[1-9]\d{0,15}$/u;
// 行號：伺服器只收 1 至 1,000,000 嘅整數；其他值唔送出去，喺欄位度講（REV-074 L-4）。
const MAX_ROW_NUMBER = 1_000_000;
const validRowNumber = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_ROW_NUMBER;
const rowNumberRules = [(value) => value === null || value === "" || validRowNumber(value) || "行號須為 1 至 1,000,000 的整數"];

const columns = [
  { name: "id", label: "工作編號", field: "id", align: "left" },
  { name: "mode", label: "模式", field: "mode", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "counts", label: "有效／警告／無效", field: "id", align: "left" },
  { name: "createdAt", label: "上載時間", field: "createdAt", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
];
const rowColumns = [
  { name: "rowNumber", label: "行號", field: "rowNumber", align: "left" },
  { name: "operation", label: "動作", field: "operation", align: "left" },
  { name: "status", label: "結果", field: "status", align: "left" },
  { name: "issues", label: "錯誤／警告", field: "rowNumber", align: "left" }
];
const statusOptions = [{ label: "全部", value: null }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))];
const rowStatusOptions = [{ label: "全部列", value: null }, ...Object.entries(ROW_LABEL).map(([value, label]) => ({ value, label }))];

const hasResult = computed(() => job.value && (["completed", "completed_with_errors"].includes(job.value.status)
  || (job.value.status === "failed" && job.value.confirmedAt !== null)));
const revoked = computed(() => job.value?.lastErrorCode === "SUPPLIER_IMPORT_AUTHORIZATION_REVOKED");
const needsApprover = computed(() => activationMode.value === "activate" && approvalRequired.value === true);

function fetchJobs({ page, rowsPerPage }) {
  return supplierImportService.listJobs({ page, rowsPerPage, status: statusFilter.value, signal });
}
function fetchRows({ page, rowsPerPage }) {
  const request = supplierImportService.getJob(detailId.value, {
    page, rowsPerPage, rowStatus: rowStatus.value, rowNumber: validRowNumber(rowNumber.value) ? rowNumber.value : undefined, signal
  });
  latestRowsRequest = request;
  // 最後發出嗰個請求先算：打字或者輪詢令舊回應（成功或者失敗）遲到嗰陣，都改用最新嗰個，唔好顯示另一行或者
  // 一個已經過時嘅錯誤（REV-073 L-2、REV-074 L-1）。
  const latest = () => latestRowsRequest;
  return request.then(latest, latest).then((result) => {
    job.value = result.job;
    if (POLLABLE.has(result.job.status) && pollTimer === null) pollTimer = setInterval(() => detailTable.value?.reload(), 2000);
    if (!POLLABLE.has(result.job.status)) stopPolling();
    return { rows: result.rows, rowsNumber: result.rowsNumber };
  }).catch((error) => {
    // 唔係自己嘅 job、或者唔存在（例如 URL 舊咗）：關返個詳情。舊請求都會收到最新嗰個錯誤，只通知一次（REV-074 I-2）。
    if (error?.status === 404 && request === latestRowsRequest) { notifyError("找不到這個匯入工作"); showDetail.value = false; }
    throw error;
  });
}
function stopPolling() {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
}
function openDetail(id) {
  detailId.value = Number(id);
  job.value = null;
  rowStatus.value = null;
  rowNumber.value = null;
  activationMode.value = "draft";
  approverUserId.value = null;
  showDetail.value = true;
  if (Number(route.query.job) !== Number(id)) router.replace({ query: { ...route.query, job: String(id) } });
  detailTable.value?.reload();
}
function closeDetail() {
  stopPolling();
  const { job: _, ...rest } = route.query;
  router.replace({ query: rest });
  table.value?.reload();
}
function reloadRows() {
  if (rowNumber.value !== null && rowNumber.value !== "" && !validRowNumber(rowNumber.value)) return;
  detailTable.value?.reload();
}
function formatDate(value) { return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadApprovalContext() {
  try {
    const { requireActivationApproval } = await supplierApprovalService.activationPolicy();
    approvalRequired.value = requireActivationApproval;
    if (requireActivationApproval) {
      const { items } = await supplierApprovalService.eligibleApprovers({ excludeUserId: session.user?.id });
      approverOptions.value = items.map((user) => ({ value: user.id, label: `${user.displayName}（${user.username}）` }));
    }
  } catch (error) {
    approvalRequired.value = null;
    notifyError(error.message || "讀取審批設定失敗");
  }
}

async function downloadTemplate() {
  busy.value = true;
  try {
    const { blob, fileName } = await supplierImportService.downloadTemplate({ signal });
    downloadBlob(blob, fileName ?? "supplier-import-template-v1.csv");
  }
  catch (error) { notifyError(error.message || "下載範本失敗"); }
  finally { busy.value = false; }
}
async function upload() {
  if (!uploadFile.value) { notifyError("請選擇 CSV 檔案"); return; }
  busy.value = true;
  try {
    const created = await supplierImportService.uploadJob({ file: uploadFile.value, mode: uploadMode.value, signal });
    showUpload.value = false;
    uploadFile.value = null;
    notifySuccess("已上載，正在預檢");
    table.value?.reload();
    openDetail(created.id);
  } catch (error) { notifyError(error.message || "上載失敗"); }
  finally { busy.value = false; }
}
async function confirmJob() {
  if (needsApprover.value && !approverUserId.value) { notifyError("目前設定要求審批，請選擇審批人"); return; }
  const target = activationMode.value === "activate"
    ? (approvalRequired.value ? "新增的供應商會送交審批（待審批）" : "新增的供應商會直接啟用")
    : "新增的供應商會以草稿建立";
  const password = await promptPassword({
    title: "確認供應商匯入",
    message: `確認執行工作 #${job.value.id}？有效列會寫入、錯誤列不寫入；已寫入的列不會因其他列失敗而回滾。${target}。`,
    okLabel: "確認匯入"
  });
  if (password === null) return;
  busy.value = true;
  try {
    await supplierImportService.confirmJob(job.value.id, {
      version: job.value.version, activationMode: activationMode.value, approverUserId: needsApprover.value ? approverUserId.value : null, password
    });
    notifySuccess("已排入執行佇列");
    detailTable.value?.reload();
  } catch (error) { notifyError(error.message || "確認失敗"); detailTable.value?.reload(); }
  finally { busy.value = false; }
}
async function cancelJob() {
  if (!(await confirm({ title: "取消供應商匯入", message: `確定取消工作 #${job.value.id}？來源檔會即時刪除，摘要及逐列結果保留。`, okLabel: "取消工作" }))) return;
  busy.value = true;
  try { await supplierImportService.cancelJob(job.value.id, job.value.version); notifySuccess("已取消"); detailTable.value?.reload(); }
  catch (error) { notifyError(error.message || "取消失敗"); detailTable.value?.reload(); }
  finally { busy.value = false; }
}
async function downloadResult() {
  busy.value = true;
  // 檔名由伺服器嘅 Content-Disposition 定（T46 I-2；HD-067 1A）；讀唔到先用同一個預設名。
  try {
    const { blob, fileName } = await supplierImportService.downloadResult(job.value.id, { signal });
    downloadBlob(blob, fileName ?? `supplier-import-${job.value.id}-result.csv`);
  }
  catch (error) {
    notifyError(error?.status === 410 ? "結果已過保留期限；工作摘要及逐列結果仍可在此查閱" : (error.message || "下載結果失敗"));
    detailTable.value?.reload();
  } finally { busy.value = false; }
}

onMounted(() => {
  void loadApprovalContext();
  const requested = route.query.job;
  // 16 位數都可能超過 Number 嘅安全範圍，要再驗（REV-074 L-3）。
  if (typeof requested === "string" && JOB_ID.test(requested) && Number.isSafeInteger(Number(requested))) openDetail(requested);
  else if (requested !== undefined) {
    const { job: _, ...rest } = route.query;
    router.replace({ query: rest });
  }
});
onUnmounted(stopPolling);
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn flat icon="description" label="下載範本" :loading="busy" @click="downloadTemplate" />
        <q-btn color="primary" unelevated icon="upload" label="上載 CSV" @click="showUpload = true" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-select v-model="statusFilter" dense outlined emit-value map-options :options="statusOptions" label="狀態" style="width: 220px"
        @update:model-value="table?.reload()" />
    </div>
    <div class="q-px-md q-pb-md">
      <DataTable ref="table" :fetch="fetchJobs" :columns="columns" row-key="id" sticky-actions>
        <template #body-cell-mode="{ value }"><q-td class="text-left">{{ MODE_LABEL[value] ?? value }}</q-td></template>
        <template #body-cell-status="{ value }"><q-td class="text-left"><q-badge :color="STATUS_COLOR[value]" :label="STATUS_LABEL[value] ?? value" /></q-td></template>
        <template #body-cell-counts="{ row }"><q-td class="text-left">{{ row.validCount }} / {{ row.warningCount }} / {{ row.invalidCount }}</q-td></template>
        <template #body-cell-createdAt="{ value }"><q-td class="text-left">{{ formatDate(value) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right"><q-btn flat dense label="詳情" :aria-label="`工作 #${row.id} 的詳情`" @click="openDetail(row.id)" /></q-td>
        </template>
      </DataTable>
    </div>

    <q-dialog v-model="showUpload" persistent>
      <q-card style="width: 440px; max-width: 92vw">
        <q-card-section><h2 class="text-h6 q-ma-none">上載供應商 CSV</h2></q-card-section>
        <q-card-section class="q-pt-none q-gutter-md">
          <div class="text-caption">請使用範本 v1。範本不含任何銀行欄位；含銀行欄位的檔案會被拒絕。預檢不會寫入任何供應商資料。</div>
          <q-select v-model="uploadMode" outlined emit-value map-options label="匯入模式"
            :options="[{ label: MODE_LABEL.create_only, value: 'create_only' }, { label: MODE_LABEL.upsert, value: 'upsert' }]" />
          <q-file v-model="uploadFile" outlined accept=".csv,text/csv" label="CSV 檔案" />
          <div class="row justify-end q-gutter-sm">
            <q-btn flat label="取消" @click="showUpload = false" />
            <q-btn color="primary" unelevated label="上載" :loading="busy" @click="upload" />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- no-route-dismiss：開詳情會寫 ?job= 入 URL，Quasar 預設一轉 route 就收埋 dialog（Playwright 捉到）。 -->
    <q-dialog v-model="showDetail" no-route-dismiss @hide="closeDetail">
      <q-card style="width: 760px; max-width: 94vw">
        <q-card-section><h2 class="text-h6 q-ma-none">匯入工作 #{{ detailId }}</h2></q-card-section>
        <q-card-section class="q-pt-none">
          <template v-if="job">
            <div class="row items-center q-gutter-sm q-mb-sm">
              <q-badge :color="STATUS_COLOR[job.status]" :label="STATUS_LABEL[job.status] ?? job.status" />
              <span class="text-caption">{{ MODE_LABEL[job.mode] ?? job.mode }}</span>
              <q-spinner v-if="POLLABLE.has(job.status)" size="16px" aria-label="處理中" />
            </div>
            <div class="q-mb-sm" data-testid="job-counts">
              共 {{ job.totalCount }} 列；有效 {{ job.validCount }}、警告 {{ job.warningCount }}、無效 {{ job.invalidCount }}；
              已寫入 {{ job.appliedCount }}、失敗 {{ job.failedCount }}、略過 {{ job.skippedCount }}
            </div>
            <q-banner v-if="revoked" class="bg-negative text-white q-mb-sm" role="alert">
              確認人的供應商管理權限已失效，工作已停止：已寫入的列保留，其餘列標記為失敗。
            </q-banner>
            <q-banner v-else-if="job.errorSummary" class="bg-negative text-white q-mb-sm" role="alert">{{ job.errorSummary }}</q-banner>

            <div v-if="CONFIRMABLE.has(job.status)" class="q-mb-md" data-testid="confirm-step">
              <div class="text-caption q-mb-sm">
                確認後背景逐列寫入：有效列會寫入，錯誤列不寫入；已寫入的列不會因其他列失敗而回滾。
                審批設定以確認當刻為準，之後更改設定不影響這個工作。
              </div>
              <div class="row q-gutter-sm items-center">
                <q-select v-model="activationMode" dense outlined emit-value map-options label="新增供應商狀態"
                  :options="[{ label: '草稿', value: 'draft' }, { label: '啟用', value: 'activate' }]" style="width: 170px" />
                <q-select v-if="needsApprover" v-model="approverUserId" dense outlined emit-value map-options label="審批人"
                  :options="approverOptions" style="width: 260px" />
                <q-btn color="primary" unelevated label="確認匯入" :loading="busy" @click="confirmJob" />
              </div>
              <div v-if="activationMode === 'activate'" class="text-caption q-mt-xs">
                {{ approvalRequired ? "目前設定要求審批：新增的供應商會以待審批狀態送交所選審批人。" : "目前設定不需審批：新增的供應商會直接啟用。" }}
                更新列只更新一般資料，不改變狀態。
              </div>
            </div>
            <div class="row q-gutter-sm q-mb-md items-center">
              <q-btn v-if="CANCELLABLE.has(job.status)" flat color="negative" label="取消工作" :loading="busy" @click="cancelJob" />
              <q-btn v-if="hasResult && !job.filesPurged" flat icon="download" label="下載結果" :loading="busy" @click="downloadResult" />
              <q-badge v-else-if="hasResult" color="grey" label="結果已過保留期限（摘要仍可查閱）" />
            </div>
          </template>
          <div v-show="job" class="row q-gutter-sm items-center q-mb-sm">
            <q-select v-model="rowStatus" dense outlined emit-value map-options :options="rowStatusOptions" label="列狀態" style="width: 150px"
              @update:model-value="reloadRows" />
            <q-input v-model.number="rowNumber" dense outlined type="number" min="1" label="行號" style="width: 120px" clearable
              :rules="rowNumberRules" hide-bottom-space
              debounce="300" @update:model-value="reloadRows" />
          </div>
          <DataTable v-show="job" ref="detailTable" :fetch="fetchRows" :columns="rowColumns" row-key="rowNumber">
            <template #body-cell-operation="{ value }"><q-td class="text-left">{{ OPERATION_LABEL[value] ?? value }}</q-td></template>
            <template #body-cell-status="{ value }"><q-td class="text-left">{{ ROW_LABEL[value] ?? value }}</q-td></template>
            <template #body-cell-issues="{ row }">
              <!-- 原因可以好長：要換行，唔好俾表格截走（真瀏覽器截圖見到）。 -->
              <q-td class="text-left" style="white-space: normal; min-width: 260px">
                <div v-for="issue in [...row.errors, ...row.warnings]" :key="`${issue.field ?? ''}-${issue.code}`" class="text-caption">
                  <q-badge v-if="issue.code === 'SUPPLIER_IMPORT_ROW_BUSY'" color="orange" label="可重新匯入" class="q-mr-xs" />
                  <span v-if="issue.field">{{ issue.field }} · </span>{{ issue.code }} · {{ issue.message }}
                </div>
              </q-td>
            </template>
          </DataTable>
          <div v-if="job && ['uploaded', 'validating'].includes(job.status)" class="text-caption q-mt-sm">預檢完成後才會顯示逐列結果。</div>
        </q-card-section>
        <q-card-actions align="right"><q-btn flat label="關閉" @click="showDetail = false" /></q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
