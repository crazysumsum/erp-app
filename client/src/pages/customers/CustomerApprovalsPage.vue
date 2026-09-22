<script>
export const page = { name: "customer-approvals", path: "/customer-approvals", title: "客戶待我審批", requires: { permissions: ["customer.view", "customer.approval"] }, menu: { group: "customers", icon: "how_to_reg", order: 20 } };
</script>
<script setup>
import { computed, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { can } from "@/framework/authorization/can.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerApprovalService from "@/services/customerApproval.js";
import customerService from "@/services/customer.js";
import { useSessionStore } from "@/stores/session.js";

const SCOPES = [{ value: "mine", label: "待我審批" }, { value: "all", label: "全部待處理" }, { value: "unassigned", label: "未指派" }];
const LABELS = { customerCode: "客戶代碼", legalName: "法定名稱", defaultCurrencyCode: "預設貨幣", identifierCount: "有效識別資料數量", creditStatus: "信用狀態" };
const columns = [{ name: "customerCode", label: "客戶代碼", field: "customerCode", align: "left" }, { name: "legalName", label: "法定名稱", field: "legalName", align: "left" }, { name: "requester", label: "提交人", field: (row) => row.requester?.displayName || row.requester?.username || "—", align: "left" }, { name: "assignedApprover", label: "審批人", field: (row) => row.assignedApprover?.displayName || row.assignedApprover?.username || "未指派", align: "left" }, { name: "actions", label: "", field: "id", align: "right" }];
const session = useSessionStore(); const scope = ref("mine"); const table = ref(null); const detail = ref(null); const loading = ref(false); const busy = ref(false); const reassignTarget = ref(null); const approvers = ref([]);
const canDecide = computed(() => detail.value?.status === "pending" && detail.value.assignedApprover?.id === session.user?.id);
const canApprove = computed(() => canDecide.value && !detail.value?.stale);
const isRequester = computed(() => detail.value?.status === "pending" && detail.value.requester?.id === session.user?.id && can(session, { permissions: ["customer.mgmt"] }));
const diffRows = computed(() => Object.entries(LABELS).map(([field, label]) => ({ field, label, submitted: format(detail.value?.submitted?.[field]), current: format(detail.value?.current?.[field]), changed: detail.value?.changedFields?.includes(field) })));
const fetchQueue = (request) => customerApprovalService.queue({ ...request, scope: scope.value, status: "pending" });
function format(value) { if (Array.isArray(value)) return value.map((item) => item.identifierValueMasked ?? item.identifierValue ?? JSON.stringify(item)).join("、") || "（無）"; return value === null || value === undefined || value === "" ? "（無）" : String(value); }
function formatDate(value) { return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }); }
function changeScope(value) { scope.value = value; detail.value = null; table.value?.reload(); }
async function loadApprovers() {
  try { const { items } = await customerApprovalService.eligibleApprovers({ excludeUserId: detail.value.requester?.id }); approvers.value = items.map((item) => ({ label: item.displayName ? `${item.displayName}（${item.username}）` : item.username, value: item.id })); }
  catch (e) { approvers.value = []; notifyError(e.message || "載入可選審批人失敗"); }
}
async function openDetail(id) { loading.value = true; try { detail.value = await customerApprovalService.get(id); reassignTarget.value = null; if (detail.value.status === "pending") await loadApprovers(); } catch (e) { detail.value = null; notifyError(e.message || "載入審批詳情失敗"); } finally { loading.value = false; } }
async function refresh() { table.value?.reload(); if (detail.value) await openDetail(detail.value.id); }
async function run(action, success) { busy.value = true; try { await action(); notifySuccess(`${detail.value.customerCode}：${success}`); await refresh(); } catch (e) { notifyError(e.message || "審批操作失敗"); if (["VERSION_CONFLICT", "APPROVAL_REQUEST_NOT_OPEN"].includes(e.code)) await refresh(); } finally { busy.value = false; } }
async function approve() { const password = await promptPassword({ title: "批准客戶啟用", message: `批准後 ${detail.value.customerCode} 會立即啟用。`, okLabel: "批准" }); if (password) await run(() => customerApprovalService.approve(detail.value.id, { password, version: detail.value.version }), "已批准並啟用"); }
async function reject() { const confirmation = await promptPassword({ title: "拒絕客戶啟用", message: "拒絕後客戶回到草稿。", okLabel: "拒絕", requireReason: true }); if (confirmation) await run(() => customerApprovalService.reject(detail.value.id, { ...confirmation, version: detail.value.version }), "已拒絕並回到草稿"); }
async function reassign() { if (!reassignTarget.value) return notifyError("請先選擇新的審批人"); const confirmation = await promptPassword({ title: "重新指派", message: "原審批人將不再負責這個申請。", okLabel: "重新指派", requireReason: true }); if (confirmation) await run(() => customerApprovalService.reassign(detail.value.id, { ...confirmation, approverUserId: reassignTarget.value, version: detail.value.version }), "已重新指派"); }
async function withdraw() { await run(() => customerService.withdrawApproval(detail.value.customerId, { approvalRequestId: detail.value.id, version: detail.value.version }), "已撤回申請"); }
</script>

<template><div><PageHeader subtitle="檢視提交快照與目前資料後處理客戶啟用審批。" /><main class="q-pa-md"><q-btn-toggle :model-value="scope" :options="SCOPES" no-caps unelevated toggle-color="primary" aria-label="審批清單範圍" class="q-mb-md" @update:model-value="changeScope" /><DataTable ref="table" :fetch="fetchQueue" :columns="columns" row-key="id" sticky-actions><template #body-cell-actions="{ row }"><q-td class="text-right"><q-btn flat dense icon="visibility" :aria-label="`查看 ${row.customerCode} 的審批詳情`" @click="openDetail(row.id)" /></q-td></template></DataTable><q-spinner-dots v-if="loading" size="2em" aria-label="載入審批詳情" /><q-card v-else-if="detail" flat bordered class="q-mt-md"><q-card-section><h2 class="text-h6 q-ma-none">{{ detail.customerCode }} — {{ detail.legalName }}</h2></q-card-section><q-card-section v-if="detail.stale" class="q-pt-none"><q-banner class="bg-warning text-dark">客戶資料在提交後已變更；這份申請不能批准，必須重新提交。</q-banner></q-card-section><q-card-section class="q-pt-none"><table class="q-table q-table--dense" aria-label="提交時快照與目前資料比較"><thead><tr><th>欄位</th><th>提交時</th><th>目前</th></tr></thead><tbody><tr v-for="row in diffRows" :key="row.field" :data-field="row.field" :class="row.changed ? 'bg-orange-1' : ''"><td>{{ row.label }}<span v-if="row.changed">・已變更</span></td><td>{{ row.submitted }}</td><td>{{ row.current }}</td></tr></tbody></table></q-card-section><q-card-section class="q-pt-none">提交人：{{ detail.requester?.displayName || detail.requester?.username || '—' }} ・審批人：{{ detail.assignedApprover?.displayName || detail.assignedApprover?.username || '未指派' }} ・提交時間：{{ formatDate(detail.requestedAt) }}<div v-if="detail.requestNote">備註：{{ detail.requestNote }}</div></q-card-section><q-card-actions align="left"><q-btn color="positive" label="批准" :disable="!canApprove || busy" @click="approve" /><q-btn color="negative" label="拒絕" :disable="!canDecide || busy" @click="reject" /><q-btn v-if="isRequester" flat label="撤回" :disable="busy" @click="withdraw" /></q-card-actions><q-card-section v-if="detail.status === 'pending'" class="row items-center q-gutter-sm"><q-select v-model="reassignTarget" :options="approvers" emit-value map-options clearable label="改派給" style="min-width:240px" /><q-btn flat color="primary" label="重新指派" :disable="busy" @click="reassign" /></q-card-section></q-card></main></div></template>
