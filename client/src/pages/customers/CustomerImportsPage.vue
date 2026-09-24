<script>
export const page = {
  name: "customer-imports", path: "/customer-imports", title: "客戶匯入",
  requires: { permissions: ["customer.view", "customer.mgmt"] },
  menu: { group: "customers", icon: "upload_file", order: 50 }
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
import customerImportService from "@/services/customerImport.js";
import { useSessionStore } from "@/stores/session.js";

const POLLABLE = new Set(["uploaded", "validating", "queued", "running"]);
const CANCELLABLE = new Set(["uploaded", "validating", "ready", "ready_with_errors", "queued"]);
const STATUS_LABEL = Object.freeze({ uploaded: "已上傳", validating: "預檢中", ready: "待確認", ready_with_errors: "待確認（有錯誤）", queued: "已排入佇列", running: "執行中", completed: "已完成", completed_with_errors: "已完成（有錯誤）", failed: "失敗", cancelled: "已取消" });
const STATUS_COLOR = Object.freeze({ uploaded: "grey", validating: "blue", ready: "orange", ready_with_errors: "warning", queued: "blue-grey", running: "blue", completed: "positive", completed_with_errors: "warning", failed: "negative", cancelled: "grey" });
const MODE_LABEL = Object.freeze({ create_only: "只新增", upsert: "新增或更新" });
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["customer.mgmt"] }));
const signal = useRequestAbort();
const table = ref(null); const detailTable = ref(null); const statusFilter = ref(null);
const showUpload = ref(false); const uploadMode = ref("create_only"); const uploadFile = ref(null); const busy = ref(false);
const showDetail = ref(false); const detailId = ref(null); const job = ref(null);
const activationMode = ref("draft"); const approverUserId = ref(null);
let pollTimer = null;

const columns = [
  { name: "id", label: "工作編號", field: "id", align: "left" },
  { name: "mode", label: "模式", field: "mode", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "counts", label: "有效／警告／無效", field: "id", align: "left" },
  { name: "createdAt", label: "建立時間", field: "createdAt", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
];
const rowColumns = [
  { name: "rowNumber", label: "列", field: "rowNumber", align: "left" },
  { name: "operation", label: "動作", field: "operation", align: "left" },
  { name: "status", label: "狀態", field: "status", align: "left" },
  { name: "issues", label: "錯誤／警告", field: "rowNumber", align: "left" }
];
const statusOptions = [{ label: "全部", value: null }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))];

function fetchJobs({ page, rowsPerPage }) {
  return customerImportService.listJobs({ page, pageSize: rowsPerPage, status: statusFilter.value, signal }).then((result) => ({ rows: result.items, rowsNumber: result.total }));
}
function fetchRows({ page, rowsPerPage }) {
  return customerImportService.getJob(detailId.value, { page, pageSize: rowsPerPage, signal }).then((result) => {
    job.value = result.job;
    if (POLLABLE.has(result.job.status) && pollTimer === null) pollTimer = setInterval(() => detailTable.value?.reload(), 2000);
    if (!POLLABLE.has(result.job.status)) stopPolling();
    return { rows: result.rows, rowsNumber: result.total };
  });
}
function stopPolling() { if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; } }
function openDetail(row) { detailId.value = row.id; job.value = null; activationMode.value = "draft"; approverUserId.value = null; showDetail.value = true; detailTable.value?.reload(); }
function closeDetail() { stopPolling(); table.value?.reload(); }
function formatDate(value) { return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }); }
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

async function downloadTemplate() {
  busy.value = true;
  try { downloadBlob((await customerImportService.downloadTemplate({ signal })).blob, "customer-import-template.csv"); }
  catch (error) { notifyError(error.message || "下載範本失敗"); }
  finally { busy.value = false; }
}
async function upload() {
  if (!uploadFile.value) { notifyError("請選擇 CSV 檔案"); return; }
  busy.value = true;
  try { await customerImportService.uploadJob({ file: uploadFile.value, mode: uploadMode.value, signal }); showUpload.value = false; notifySuccess("已上傳，正在預檢"); table.value?.reload(); }
  catch (error) { notifyError(error.message || "上傳失敗"); }
  finally { busy.value = false; }
}
async function confirmJob() {
  const password = await promptPassword({ title: "確認客戶匯入", message: `確認執行工作 #${job.value.id}？有效資料會依選擇以草稿或啟用方式寫入。`, okLabel: "確認匯入" });
  if (password === null) return;
  busy.value = true;
  try { await customerImportService.confirmJob(job.value.id, { version: job.value.version, activationMode: activationMode.value, approverUserId: approverUserId.value, password }); notifySuccess("已排入執行佇列"); detailTable.value?.reload(); }
  catch (error) { notifyError(error.message || "確認失敗"); }
  finally { busy.value = false; }
}
async function cancelJob() {
  if (!(await confirm({ title: "取消客戶匯入", message: `確定取消工作 #${job.value.id}？`, okLabel: "取消工作" }))) return;
  busy.value = true;
  try { await customerImportService.cancelJob(job.value.id, job.value.version); notifySuccess("已取消"); detailTable.value?.reload(); }
  catch (error) { notifyError(error.message || "取消失敗"); }
  finally { busy.value = false; }
}
async function downloadResult() {
  busy.value = true;
  try { downloadBlob((await customerImportService.downloadResult(job.value.id, { signal })).blob, `customer-import-${job.value.id}-result.csv`); }
  catch (error) { notifyError(error.message || "下載結果失敗"); }
  finally { busy.value = false; }
}
onUnmounted(stopPolling);
</script>

<template>
  <div>
    <PageHeader>
      <template #actions>
        <q-btn flat icon="description" label="下載範本" :loading="busy" @click="downloadTemplate" />
        <q-btn v-if="canManage" color="primary" unelevated icon="upload" label="上傳 CSV" @click="showUpload = true" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md row q-gutter-sm items-center">
      <q-select v-model="statusFilter" dense outlined emit-value map-options :options="statusOptions" label="狀態" style="width: 220px" @update:model-value="table?.reload()" />
    </div>
    <div class="q-px-md q-pb-md">
      <DataTable ref="table" :fetch="fetchJobs" :columns="columns" row-key="id" sticky-actions>
        <template #body-cell-mode="{ value }"><q-td class="text-left">{{ MODE_LABEL[value] ?? value }}</q-td></template>
        <template #body-cell-status="{ value }"><q-td class="text-left"><q-badge :color="STATUS_COLOR[value]" :label="STATUS_LABEL[value] ?? value" /></q-td></template>
        <template #body-cell-counts="{ row }"><q-td class="text-left">{{ row.validCount }} / {{ row.warningCount }} / {{ row.invalidCount }}</q-td></template>
        <template #body-cell-createdAt="{ value }"><q-td class="text-left">{{ formatDate(value) }}</q-td></template>
        <template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat dense label="詳情" :aria-label="`工作 #${row.id} 的詳情`" @click="openDetail(row)" /></q-td></template>
      </DataTable>
    </div>

    <q-dialog v-model="showUpload" persistent>
      <q-card style="width: 420px; max-width: 92vw"><q-card-section><h2 class="text-h6 q-ma-none">上傳客戶 CSV</h2></q-card-section>
        <q-card-section class="q-pt-none q-gutter-md">
          <q-select v-model="uploadMode" outlined emit-value map-options label="匯入模式" :options="[{ label: MODE_LABEL.create_only, value: 'create_only' }, { label: MODE_LABEL.upsert, value: 'upsert' }]" />
          <q-file v-model="uploadFile" outlined accept=".csv,text/csv" label="CSV 檔案" />
          <div class="row justify-end q-gutter-sm"><q-btn flat label="取消" @click="showUpload = false" /><q-btn color="primary" unelevated label="上傳" :loading="busy" @click="upload" /></div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showDetail" @hide="closeDetail">
      <q-card style="width: 680px; max-width: 92vw"><q-card-section><h2 class="text-h6 q-ma-none">匯入工作 #{{ detailId }}</h2></q-card-section>
        <q-card-section class="q-pt-none">
          <template v-if="job">
            <div class="row items-center q-gutter-sm q-mb-sm"><q-badge :color="STATUS_COLOR[job.status]" :label="STATUS_LABEL[job.status] ?? job.status" /><q-spinner v-if="POLLABLE.has(job.status)" size="16px" /></div>
            <div class="q-mb-sm">共 {{ job.totalCount }} 列；有效 {{ job.validCount }}、警告 {{ job.warningCount }}、無效 {{ job.invalidCount }}、成功 {{ job.successCount }}、失敗 {{ job.failedCount }}、略過 {{ job.skippedCount }}</div>
            <q-banner v-if="job.errorSummary" class="bg-negative text-white q-mb-sm">{{ job.errorSummary }}</q-banner>
            <div v-if="['ready', 'ready_with_errors'].includes(job.status)" class="row q-gutter-sm items-center q-mb-md">
              <q-select v-model="activationMode" dense outlined emit-value map-options label="寫入狀態" :options="[{ label: '草稿', value: 'draft' }, { label: '啟用', value: 'activate' }]" style="width: 150px" />
              <q-input v-if="activationMode === 'activate'" v-model.number="approverUserId" dense outlined type="number" min="1" label="審批人 ID（如設定要求）" style="width: 220px" />
              <q-btn color="primary" unelevated label="確認匯入" :loading="busy" @click="confirmJob" />
            </div>
            <div class="row q-gutter-sm q-mb-md">
              <q-btn v-if="CANCELLABLE.has(job.status)" flat color="negative" label="取消" :loading="busy" @click="cancelJob" />
              <q-btn v-if="['completed', 'completed_with_errors'].includes(job.status) && job.resultStorageStatus === 'active'" flat icon="download" label="下載結果" :loading="busy" @click="downloadResult" />
              <q-badge v-else-if="['completed', 'completed_with_errors'].includes(job.status)" color="grey" label="結果檔已過期或不可用" />
            </div>
          </template>
          <DataTable v-show="job" ref="detailTable" :fetch="fetchRows" :columns="rowColumns" row-key="rowNumber">
            <template #body-cell-issues="{ row }"><q-td class="text-left"><div v-for="issue in [...row.errors, ...row.warnings]" :key="`${issue.field}-${issue.code}`" class="text-caption">{{ issue.field }} · {{ issue.code }} · {{ issue.message }}</div></q-td></template>
          </DataTable>
        </q-card-section><q-card-actions align="right"><q-btn flat label="關閉" @click="showDetail = false" /></q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>
