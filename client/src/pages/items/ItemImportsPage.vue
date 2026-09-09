<script>
export const page = {
  name: "imports",
  path: "/items/imports",
  title: "匯入／匯出",
  requires: { permissions: ["item.mgmt"] },
  menu: { group: "items", icon: "upload_file", order: 60 }
};
</script>

<script setup>
import { computed, onUnmounted, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { can } from "@/framework/authorization/can.js";
import { confirm, promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useRequestAbort } from "@/framework/http/useRequestAbort.js";
import itemImportService from "@/services/itemImport.js";
import { useSessionStore } from "@/stores/session.js";

/**
 * 商品匯入頁：template 下載、上傳、預檢／執行進度、確認、取消、錯誤及結果
 * 下載。設計說明見 docs/items_management/design_spec.md §6.8、§7.2。
 *
 * Job 狀態機（§5.13）：uploaded → validating → ready／invalid（預檢完成，
 * 未動商品表）→（confirm）queued → running →（execution）completed／failed，
 * 或喺 uploaded／ready／queued 任一步 cancel。呢度淨係 uploaded／
 * validating／queued／running 呢幾個「背景 worker 會自動推進」嘅狀態先
 * poll，等使用者睇到進度；ready／invalid／completed／failed／cancelled
 * 係要等使用者決定或者已經終結嘅狀態，唔使 poll。
 */
const POLLABLE_STATUSES = new Set(["uploaded", "validating", "queued", "running"]);
const CANCELLABLE_STATUSES = new Set(["uploaded", "ready", "queued"]);
const POLL_INTERVAL_MS = 2000;

const STATUS_LABEL = {
  uploaded: "已上傳",
  validating: "預檢中",
  invalid: "預檢不通過",
  ready: "待確認",
  queued: "已排入佇列",
  running: "執行中",
  completed: "已完成",
  failed: "執行失敗",
  cancelled: "已取消"
};
const STATUS_COLOUR = {
  uploaded: "grey",
  validating: "blue",
  invalid: "negative",
  ready: "orange",
  queued: "blue-grey",
  running: "blue",
  completed: "positive",
  failed: "negative",
  cancelled: "grey"
};
const MODE_LABEL = { create_only: "只新增", upsert: "新增與更新並存" };
const ROW_STATUS_LABEL = {
  valid: "有效",
  warning: "有效（有警告）",
  invalid: "無效",
  applied: "已套用",
  skipped: "已略過",
  failed: "執行失敗"
};

const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["item.mgmt"] }));
const requestSignal = useRequestAbort();

const STATUS_FILTER_OPTIONS = [
  { label: "全部狀態", value: null },
  ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ label, value }))
];
const statusFilter = ref(null);
const dataTableRef = ref(null);

function fetchJobs({ page, rowsPerPage }) {
  return itemImportService
    .listJobs({ page, pageSize: rowsPerPage, status: statusFilter.value, signal: requestSignal })
    .then((result) => ({ rows: result.items, rowsNumber: result.total }));
}

const columns = [
  { name: "id", label: "工作編號", field: "id", align: "left", sortable: false },
  { name: "mode", label: "模式", field: "mode", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "counts", label: "成功／警告／失敗", field: "id", align: "left" },
  { name: "createdAt", label: "上傳時間", field: "createdAt", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
];

function formatDateTime(epochMs) {
  return new Date(epochMs).toLocaleString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* ---------------- 下載範本 ---------------- */

const downloadingTemplate = ref(false);

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadTemplate() {
  downloadingTemplate.value = true;
  try {
    const { blob } = await itemImportService.downloadTemplate({ signal: requestSignal });
    triggerBlobDownload(blob, "item-import-template.csv");
  } catch (error) {
    notifyError(error.message || "下載範本失敗");
  } finally {
    downloadingTemplate.value = false;
  }
}

/* ---------------- 上傳 ---------------- */

const showUploadDialog = ref(false);
const uploadMode = ref("create_only");
const uploadFile = ref(null);
const uploading = ref(false);
const uploadError = ref("");

function openUploadDialog() {
  uploadMode.value = "create_only";
  uploadFile.value = null;
  uploadError.value = "";
  showUploadDialog.value = true;
}

async function submitUpload() {
  if (!uploadFile.value) {
    uploadError.value = "請選擇要上傳的 CSV 檔案";
    return;
  }

  uploading.value = true;
  uploadError.value = "";
  try {
    await itemImportService.uploadJob({ file: uploadFile.value, mode: uploadMode.value });
    notifySuccess("已上傳，正在背景預檢");
    showUploadDialog.value = false;
    dataTableRef.value?.reload();
  } catch (error) {
    uploadError.value = error.message || "上傳失敗";
    notifyError(uploadError.value);
  } finally {
    uploading.value = false;
  }
}

/* ---------------- 詳情／進度／確認／取消／結果 ---------------- */

const showDetailDialog = ref(false);
const detailJobId = ref(null);
const jobDetail = ref(null);
const rowsTableRef = ref(null);
let pollTimer = null;

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!showDetailDialog.value || !POLLABLE_STATUSES.has(jobDetail.value?.status)) {
      stopPolling();
      return;
    }
    rowsTableRef.value?.reload();
  }, POLL_INTERVAL_MS);
}

function fetchDetailRows({ page, rowsPerPage }) {
  return itemImportService
    .getJob(detailJobId.value, { page, pageSize: rowsPerPage, signal: requestSignal })
    .then((result) => {
      jobDetail.value = result.job;
      if (POLLABLE_STATUSES.has(result.job.status)) {
        if (pollTimer === null) {
          startPolling();
        }
      } else {
        stopPolling();
      }
      return { rows: result.rows.items, rowsNumber: result.rows.total };
    });
}

// 明確叫 `rowsTableRef.value?.reload()`，唔淨係靠 DataTable 自己
// `onMounted` 嗰下 fetch：QDialog 開關之間會唔會拆咗再重新 mount 個 slot
// content 屬於佢內部實作細節，唔可以假設——如果佢冇拆（keep-alive 咁樣），
// 由第二個 job 開始，`onMounted` 就唔會再觸發，`fetchDetailRows` 永遠唔會
// 為個新 jobId 行多一次，個 dialog 會停喺 loading spinner 度。明確 reload
// 兩種情況都啱：啱啱先 mount 就等於初次 fetch，冇拆冇重 mount 就係強制
// 為新 job 攞返新資料。
function openDetail(row) {
  detailJobId.value = row.id;
  jobDetail.value = null;
  showDetailDialog.value = true;
  rowsTableRef.value?.reload();
}

// 用 `@hide` 而唔係手動 `:model-value`＋`@update:model-value`：`@hide` 由
// QDialog 喺「任何原因變成隱藏」嗰刻可靠咁 emit（v-model 改、撳 ESC、
// 撳背景），同 v-model 本身嘅開關邏輯分開，唔會出現兩個來源打交叉、
// dialog 內部狀態同 `showDetailDialog` 呢個 ref 唔同步嘅情況——之前用
// `:model-value`／`@update:model-value` 呢個手動版本試過出現一個殘留、
// 已經同 QDialog 內部狀態脫鈎嘅 dialog 節點仲留喺 DOM，擋住咗底下嘅
// 「詳情」按鈕接收下一次 click。
function closeDetail() {
  stopPolling();
  detailJobId.value = null;
  jobDetail.value = null;
  dataTableRef.value?.reload();
}

const rowColumns = [
  { name: "rowNumber", label: "第幾列", field: "rowNumber", align: "left" },
  { name: "operation", label: "動作", field: "operation", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "issues", label: "錯誤／警告", field: "rowNumber", align: "left" }
];

const confirming = ref(false);
const cancelling = ref(false);
const downloadingResult = ref(false);

async function confirmJob() {
  const job = jobDetail.value;
  if (!job) {
    return;
  }

  const outcome = await promptPassword({
    title: "確認匯入",
    message: `確認匯入工作 #${job.id}？將會套用 ${job.successCount + job.warningCount} 筆變更（${MODE_LABEL[job.mode]}），此操作不可復原。`,
    okLabel: "確認匯入",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }

  confirming.value = true;
  try {
    await itemImportService.confirmJob(job.id, { ...outcome, version: job.version });
    notifySuccess("已確認，即將開始執行");
    rowsTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "確認失敗");
  } finally {
    confirming.value = false;
  }
}

async function cancelJob() {
  const job = jobDetail.value;
  if (!job) {
    return;
  }

  const outcome = await confirm({
    title: "取消匯入",
    message: `確定要取消匯入工作 #${job.id}？取消後不能還原。`,
    okLabel: "取消匯入"
  });
  if (!outcome) {
    return;
  }

  cancelling.value = true;
  try {
    await itemImportService.cancelJob(job.id);
    notifySuccess("已取消");
    rowsTableRef.value?.reload();
  } catch (error) {
    notifyError(error.message || "取消失敗");
  } finally {
    cancelling.value = false;
  }
}

async function downloadResult() {
  const job = jobDetail.value;
  if (!job) {
    return;
  }

  downloadingResult.value = true;
  try {
    const { blob } = await itemImportService.downloadResult(job.id, { signal: requestSignal });
    triggerBlobDownload(blob, `item-import-${job.id}-result.csv`);
  } catch (error) {
    notifyError(error.message || "下載結果失敗");
  } finally {
    downloadingResult.value = false;
  }
}

onUnmounted(stopPolling);
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn
          v-if="canManage"
          flat
          label="下載範本"
          icon="description"
          :loading="downloadingTemplate"
          @click="downloadTemplate"
        />
        <q-btn v-if="canManage" color="primary" unelevated label="上傳 CSV" icon="upload" @click="openUploadDialog" />
      </template>
    </PageHeader>

    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-select
        v-model="statusFilter"
        dense
        outlined
        emit-value
        map-options
        :options="STATUS_FILTER_OPTIONS"
        style="width: 200px"
        label="狀態"
        @update:model-value="dataTableRef?.reload()"
      />
    </div>

    <div class="q-px-md q-pb-md">
      <DataTable ref="dataTableRef" :fetch="fetchJobs" :columns="columns" row-key="id" sticky-actions>
        <template #body-cell-mode="{ value }">
          <q-td class="text-left">{{ MODE_LABEL[value] ?? value }}</q-td>
        </template>

        <template #body-cell-status="{ value }">
          <q-td class="text-left">
            <q-badge :color="STATUS_COLOUR[value]" :label="STATUS_LABEL[value] ?? value" />
          </q-td>
        </template>

        <template #body-cell-counts="{ row }">
          <q-td class="text-left">{{ row.successCount }} / {{ row.warningCount }} / {{ row.failureCount }}</q-td>
        </template>

        <template #body-cell-createdAt="{ value }">
          <q-td class="text-left">{{ formatDateTime(value) }}</q-td>
        </template>

        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn flat dense label="詳情" :aria-label="`工作 #${row.id} 的詳情`" @click="openDetail(row)" />
          </q-td>
        </template>
      </DataTable>
    </div>

    <!-- 上傳 -->
    <q-dialog v-model="showUploadDialog" persistent>
      <q-card style="min-width: 420px">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">上傳 CSV</h2>
        </q-card-section>
        <q-card-section class="q-pt-none q-gutter-md">
          <q-banner v-if="uploadError" class="bg-negative text-white">{{ uploadError }}</q-banner>
          <q-select
            v-model="uploadMode"
            outlined
            emit-value
            map-options
            label="匯入模式"
            :options="[
              { label: MODE_LABEL.create_only, value: 'create_only' },
              { label: MODE_LABEL.upsert, value: 'upsert' }
            ]"
          />
          <q-file v-model="uploadFile" outlined label="CSV 檔案" accept=".csv,text/csv" :disable="uploading" />
          <div class="row justify-end q-gutter-sm">
            <q-btn flat label="取消" :disable="uploading" @click="showUploadDialog = false" />
            <q-btn color="primary" unelevated label="上傳" :loading="uploading" @click="submitUpload" />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <!-- 詳情 -->
    <q-dialog v-model="showDetailDialog" @hide="closeDetail">
      <q-card style="min-width: 640px; max-width: 90vw">
        <q-card-section>
          <h2 class="text-h6 q-ma-none">匯入工作 #{{ detailJobId }}</h2>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div v-if="!jobDetail" class="text-center q-pa-md">
            <q-spinner size="32px" />
          </div>

          <template v-else>
            <div class="row items-center q-gutter-sm q-mb-sm">
              <q-badge :color="STATUS_COLOUR[jobDetail.status]" :label="STATUS_LABEL[jobDetail.status] ?? jobDetail.status" />
              <span>{{ MODE_LABEL[jobDetail.mode] }}</span>
              <q-spinner v-if="POLLABLE_STATUSES.has(jobDetail.status)" size="16px" class="q-ml-sm" />
            </div>

            <div class="text-body2 q-mb-sm">
              共 {{ jobDetail.totalCount }} 列：成功 {{ jobDetail.successCount }}、警告
              {{ jobDetail.warningCount }}、失敗 {{ jobDetail.failureCount }}、略過 {{ jobDetail.skippedCount }}
            </div>

            <q-banner v-if="jobDetail.errorSummary" class="bg-negative text-white q-mb-sm">
              {{ jobDetail.errorSummary }}
            </q-banner>

            <div class="row q-gutter-sm q-mb-md">
              <q-btn
                v-if="canManage && jobDetail.status === 'ready'"
                color="primary"
                unelevated
                label="確認匯入"
                :loading="confirming"
                @click="confirmJob"
              />
              <q-btn
                v-if="canManage && CANCELLABLE_STATUSES.has(jobDetail.status)"
                flat
                color="negative"
                label="取消"
                :loading="cancelling"
                @click="cancelJob"
              />
              <q-btn
                v-if="jobDetail.resultStoredName && !jobDetail.filesPurgedAt"
                flat
                label="下載結果"
                icon="download"
                :loading="downloadingResult"
                @click="downloadResult"
              />
              <q-badge v-else-if="jobDetail.resultStoredName && jobDetail.filesPurgedAt" color="grey" label="結果檔已過期" />
            </div>
          </template>

          <!-- 呢個表一定要無條件 render（唔可以再套一層 `v-if="jobDetail"`）：
               佢自己 `onMounted` 嗰下 fetch（`fetchDetailRows`）正正係
               `jobDetail` 唯一嘅資料來源。加返個條件會變成死結——jobDetail
               未有資料所以唔 render，但唔 render 就永遠攞唔到資料。 -->
          <DataTable
            v-show="jobDetail"
            ref="rowsTableRef"
            :fetch="fetchDetailRows"
            :columns="rowColumns"
            row-key="rowNumber"
          >
            <template #body-cell-status="{ value }">
              <q-td class="text-left">{{ ROW_STATUS_LABEL[value] ?? value }}</q-td>
            </template>

            <template #body-cell-issues="{ row }">
              <q-td class="text-left">
                <div v-for="(issue, index) in [...row.errors, ...row.warnings]" :key="index" class="text-caption">
                  {{ issue.message }}
                </div>
              </q-td>
            </template>
          </DataTable>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="關閉" @click="showDetailDialog = false" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
