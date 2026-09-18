<script>
export const page = {
  name: "supplier-approvals",
  path: "/suppliers/approvals",
  title: "待我審批",
  // API 要求 supplier.view＋supplier.approval，所以 route guard 要求同一對；
  // 只守其中一個會令使用者入到頁但每個請求都 403（設計 §6.4）。
  requires: { permissions: ["supplier.view", "supplier.approval"] },
  menu: { group: "suppliers", icon: "how_to_reg", order: 20 }
};
</script>

<script setup>
import { computed, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import supplierApprovalService from "@/services/supplierApproval.js";

/**
 * 設計 §7.6。Queue 預設只顯示指定俾自己嘅 Pending，另有「全部待處理」同「未指派」。
 * Detail 顯示提交時嘅 snapshot 同 Supplier 現況嘅 diff；snapshot 過時就唔准批准。
 */

const SCOPES = Object.freeze([
  { value: "mine", label: "待我審批" },
  { value: "all", label: "全部待處理" },
  { value: "unassigned", label: "未指派" }
]);

const FIELD_LABEL = Object.freeze({
  supplierCode: "Supplier Code",
  supplierName: "名稱",
  displayName: "顯示名稱",
  defaultCurrencyCode: "預設貨幣",
  defaultPaymentTermId: "預設付款條款",
  identifiers: "識別資料"
});

const columns = Object.freeze([
  { name: "supplierCode", label: "Supplier Code", field: "supplierCode", align: "left" },
  { name: "supplierName", label: "名稱", field: "supplierName", align: "left" },
  { name: "requester", label: "提交人", field: (row) => row.requester?.displayName || row.requester?.username || "—", align: "left" },
  { name: "assignedApprover", label: "審批人", field: (row) => row.assignedApprover?.displayName || row.assignedApprover?.username || "未指派", align: "left" },
  { name: "requestedAt", label: "提交時間", field: "requestedAt", align: "left" },
  { name: "actions", label: "", field: "id", align: "right" }
]);

const session = useSessionStore();
const scope = ref("mine");
const table = ref(null);
const detail = ref(null);
const detailLoading = ref(false);
const busy = ref(false);

function fetchQueue(request) {
  return supplierApprovalService.queue({ ...request, scope: scope.value, status: "pending" });
}

function changeScope(value) {
  scope.value = value;
  detail.value = null;
  table.value?.reload();
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" });
}

function formatValue(field, value) {
  if (field === "identifiers") {
    return (value ?? []).map((row) => `${row.identifierType}／${row.issuerCountryCode}／${row.identifierValueMasked}`).join("、") || "（無）";
  }
  return value === null || value === undefined || value === "" ? "（無）" : String(value);
}

// 設計 §4.5：只有被指派嘅審批人可以決定。
const canDecide = computed(() =>
  Boolean(detail.value)
  && detail.value.status === "pending"
  && detail.value.assignedApprover?.id === session.user?.id);

// AC-012：提交之後 Supplier 改過就唔可以批舊申請。`stale` 同服務層批准時用嘅判準
// 係同一個，所以呢度禁用嘅嘢，服務層唔會突然又批得。
//
// 只綁住批准，唔綁拒絕：服務層嘅 #assertRequestStillCurrent 喺 `command.status
// !== "approved"` 就已經 return，即係拒絕同撤回本身唔受 stale 影響，設計 §7.6 亦
// 都只寫「stale 時禁止 approve」。一併禁埋拒絕會令 UI 擋住一個服務層會接受嘅動作，
// 而且過時申請最合理嘅出路正正就係拒絕（REV-030 L-1）。
const canApprove = computed(() => canDecide.value && !detail.value.stale);

const isRequester = computed(() =>
  Boolean(detail.value) && detail.value.status === "pending" && detail.value.requester?.id === session.user?.id);

const diffRows = computed(() => {
  if (!detail.value?.submitted || !detail.value?.current) return [];
  return Object.keys(FIELD_LABEL).map((field) => ({
    field,
    label: FIELD_LABEL[field],
    submitted: formatValue(field, detail.value.submitted[field]),
    current: formatValue(field, detail.value.current[field]),
    changed: detail.value.changedFields.includes(field)
  }));
});

async function openDetail(id) {
  detailLoading.value = true;
  reassignTarget.value = null;
  try {
    detail.value = await supplierApprovalService.get(id);
    // 開咗 detail 就順手攞可選審批人。本來掛喺 select 嘅 @focus，但嗰個事件由
    // Quasar 內部嘅 input 發出，喺測試環境到唔到 —— 一個到唔到嘅載入時機，就係
    // 一個驗唔到嘅控制。開 detail 係確定性嘅。
    if (detail.value.status === "pending") await loadReassignOptions();
  } catch (error) {
    detail.value = null;
    notifyError(error.message || "載入審批詳情失敗");
  } finally {
    detailLoading.value = false;
  }
}

async function refresh() {
  table.value?.reload();
  if (detail.value) await openDetail(detail.value.id);
}

/**
 * 成功通知帶 Supplier Code 同結果，唔係淨係「成功」（設計 §7.6）。
 */
async function run(action, { outcome }) {
  busy.value = true;
  try {
    const result = await action();
    notifySuccess(`${detail.value.supplierCode}：${outcome(result)}`);
    await refresh();
  } catch (error) {
    notifyError(error.message || "操作失敗");
    // 版本或狀態衝突之後，畫面要對返現況先可以再決定一次。
    if (error.code === "VERSION_CONFLICT" || error.code === "APPROVAL_REQUEST_NOT_OPEN") await refresh();
  } finally {
    busy.value = false;
  }
}

// 重新指派要揀人，所以呢一頁自己攞一次 eligible list——排除提交人，同 submit 時
// 同一條規則（BR-012）。
const reassignTarget = ref(null);
const reassignOptions = ref([]);
async function loadReassignOptions() {
  try {
    const { items } = await supplierApprovalService.eligibleApprovers({ excludeUserId: detail.value?.requester?.id });
    reassignOptions.value = items.map((approver) => ({
      label: approver.displayName ? `${approver.displayName}（${approver.username}）` : approver.username,
      value: approver.id
    }));
  } catch (error) {
    reassignOptions.value = [];
    notifyError(error.message || "載入可選審批人失敗");
  }
}

async function approve() {
  const password = await promptPassword({ title: "批准啟用", message: `批准後 ${detail.value.supplierCode} 會立即啟用。`, okLabel: "批准" });
  if (!password) return;
  const request = detail.value;
  await run(
    () => supplierApprovalService.approve(request.id, { password, version: request.version }),
    { outcome: () => "已批准，供應商已啟用" }
  );
}

async function reject() {
  const confirmation = await promptPassword({ title: "拒絕啟用", message: "拒絕後供應商回到草稿，提交人會看到你填的原因。", okLabel: "拒絕", requireReason: true });
  if (!confirmation) return;
  const request = detail.value;
  await run(
    () => supplierApprovalService.reject(request.id, { ...confirmation, version: request.version }),
    { outcome: () => "已拒絕，供應商回到草稿" }
  );
}

async function reassign() {
  if (!reassignTarget.value) {
    notifyError("請先選擇新的審批人");
    return;
  }
  const confirmation = await promptPassword({ title: "重新指派", message: "指派後原審批人不再負責這個申請。", okLabel: "重新指派", requireReason: true });
  if (!confirmation) return;
  const request = detail.value;
  const target = reassignTarget.value;
  await run(
    () => supplierApprovalService.reassign(request.id, { ...confirmation, approverUserId: target, version: request.version }),
    { outcome: () => "已重新指派" }
  );
  reassignTarget.value = null;
}

async function withdraw() {
  const request = detail.value;
  await run(
    () => supplierApprovalService.withdraw(request.supplierId, { requestId: request.id, version: request.version }),
    { outcome: (result) => `已撤回，供應商回到${result.supplierStatus === "draft" ? "草稿" : result.supplierStatus}` }
  );
}

</script>

<template>
  <div>
    <PageHeader subtitle="處理待啟用的供應商審批申請。" />

    <main class="q-pa-md">
      <q-btn-toggle
        :model-value="scope"
        :options="SCOPES"
        no-caps
        unelevated
        toggle-color="primary"
        class="q-mb-md"
        aria-label="審批清單範圍"
        @update:model-value="changeScope"
      />

      <DataTable ref="table" :fetch="fetchQueue" :columns="columns" row-key="id" sticky-actions>
        <template #body-cell-requestedAt="{ value }"><q-td class="text-left">{{ formatDate(value) }}</q-td></template>
        <template #body-cell-actions="{ row }">
          <q-td class="text-right">
            <q-btn flat dense icon="visibility" :aria-label="`查看 ${row.supplierCode} 的審批詳情`" @click="openDetail(row.id)" />
          </q-td>
        </template>
      </DataTable>

      <q-spinner-dots v-if="detailLoading" size="2em" class="q-mt-md" aria-label="載入審批詳情" />

      <q-card v-else-if="detail" flat bordered class="q-mt-md">
        <q-card-section class="row items-center justify-between">
          <h2 class="text-subtitle1 q-ma-none">{{ detail.supplierCode }} — {{ detail.supplierName }}</h2>
          <q-chip v-if="detail.stale" color="warning" text-color="white" label="提交後已變更" />
        </q-card-section>

        <q-card-section v-if="detail.stale" class="q-pt-none">
          <q-banner class="bg-warning text-dark" rounded>
            供應商資料在提交之後改過，這個申請已經過時，不能批准。請提交人重新提交審批。
          </q-banner>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <table class="q-table q-table--dense" aria-label="提交時快照與目前資料比較">
            <thead>
              <tr><th class="text-left">欄位</th><th class="text-left">提交時</th><th class="text-left">目前</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in diffRows" :key="row.field" :data-field="row.field" :class="row.changed ? 'bg-orange-1' : ''">
                <td class="text-left">{{ row.label }}<span v-if="row.changed" class="text-negative"> ・已變更</span></td>
                <td class="text-left">{{ row.submitted }}</td>
                <td class="text-left">{{ row.current }}</td>
              </tr>
            </tbody>
          </table>
        </q-card-section>

        <q-card-section class="q-pt-none text-body2">
          提交人：{{ detail.requester?.displayName || detail.requester?.username || "—" }}
          ・審批人：{{ detail.assignedApprover?.displayName || detail.assignedApprover?.username || "未指派" }}
          ・提交時間：{{ formatDate(detail.requestedAt) }}
          <div v-if="detail.requestNote" class="q-mt-xs">備註：{{ detail.requestNote }}</div>
        </q-card-section>

        <q-card-actions align="left" class="q-px-md q-pb-md">
          <q-btn color="positive" label="批准" :disable="!canApprove || busy" :loading="busy" @click="approve" />
          <q-btn color="negative" label="拒絕" :disable="!canDecide || busy" :loading="busy" @click="reject" />
          <q-btn v-if="isRequester" flat label="撤回" :disable="busy" :loading="busy" @click="withdraw" />
        </q-card-actions>

        <q-card-section v-if="detail.status === 'pending'" class="q-pt-none">
          <div class="row items-center q-gutter-sm">
            <q-select
              v-model="reassignTarget"
              :options="reassignOptions"
              label="改派給"
              emit-value
              map-options
              clearable
              style="min-width: 240px"
            />
            <q-btn flat color="primary" label="重新指派" :disable="busy" :loading="busy" @click="reassign" />
          </div>
        </q-card-section>
      </q-card>
    </main>
  </div>
</template>
