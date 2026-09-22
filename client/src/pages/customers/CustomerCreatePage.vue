<script>
export const page = { name: "customer-create", path: "/customers/new", title: "新增客戶", requires: { permissions: ["customer.mgmt"] } };
</script>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import businessMasterService from "@/services/businessMaster.js";
import customerApprovalService from "@/services/customerApproval.js";
import customerService from "@/services/customer.js";
import { useSessionStore } from "@/stores/session.js";

const session = useSessionStore();
const form = reactive({ customerCode: "", legalName: "", tradingName: "", defaultCurrencyCode: null, generalPhone: "", generalEmail: "", website: "", notes: "" });
const currencies = ref([]); const dirty = ref(false); const submitting = ref(false); const error = ref(""); const created = ref(null); const approverRequired = ref(false); const approverUserId = ref(null); const approvers = ref([]);
const valid = computed(() => form.customerCode.trim() && form.legalName.trim() && (!approverRequired.value || approverUserId.value));
watch(form, () => { dirty.value = true; }, { deep: true });
onBeforeRouteLeave(() => !dirty.value || window.confirm("有未儲存的變更，確定要離開這一頁嗎？"));
function payload(activate) { return { customerCode: form.customerCode.trim(), legalName: form.legalName.trim(), tradingName: form.tradingName.trim(), defaultCurrencyCode: form.defaultCurrencyCode, generalPhone: form.generalPhone.trim(), generalEmail: form.generalEmail.trim(), website: form.website.trim(), notes: form.notes.trim(), activate, ...(approverRequired.value ? { approverUserId: approverUserId.value } : {}) }; }
async function loadCurrencies() { try { const result = await businessMasterService.currencyList({ page: 1, rowsPerPage: 100, status: "ACTIVE", sortBy: "code" }); currencies.value = result.rows.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.code })); } catch (loadError) { notifyError(loadError.message || "載入貨幣失敗"); } }
async function submit(activate) {
  if (submitting.value || !valid.value) return;
  submitting.value = true; error.value = "";
  try {
    const duplicates = await customerService.checkDuplicates(payload(false));
    if ([...(duplicates.code ?? []), ...(duplicates.legalName ?? []), ...(duplicates.tradingName ?? [])].length) { error.value = "找到可能重複的客戶，請先確認資料。"; return; }
    created.value = (await customerService.create(payload(activate))).customer; dirty.value = false; notifySuccess(`客戶 ${created.value.code} 已儲存`);
  } catch (submitError) {
    if (activate && submitError.code === "APPROVER_REQUIRED") {
      approverRequired.value = true;
      error.value = "目前設定要求啟用前選擇審批人。";
      try { approvers.value = (await customerApprovalService.eligibleApprovers({ excludeUserId: session.user?.id })).items; } catch (lookupError) { error.value = lookupError.message || "載入審批人失敗"; }
    } else error.value = submitError.message || "建立客戶失敗";
    notifyError(error.value || submitError.message || "建立客戶失敗");
  } finally { submitting.value = false; }
}
onMounted(loadCurrencies);
</script>

<template>
  <div>
    <PageHeader subtitle="可先建立 Draft；啟用規則由伺服器以目前設定決定。" />
    <main class="q-pa-md" style="max-width: 900px">
      <q-banner v-if="created" class="bg-positive text-white q-mb-md" rounded role="status">客戶 {{ created.code }} 已建立；狀態：{{ created.status === 'pending_approval' ? '待審批' : created.status === 'active' ? '啟用' : '草稿' }}</q-banner>
      <q-banner v-if="error" class="bg-negative text-white q-mb-md" role="alert">{{ error }}</q-banner>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6"><q-input v-model="form.customerCode" label="客戶代碼 *" outlined dense maxlength="64" /></div>
        <div class="col-12 col-md-6"><q-input v-model="form.legalName" label="法定名稱 *" outlined dense maxlength="190" /></div>
        <div class="col-12 col-md-6"><q-input v-model="form.tradingName" label="交易名稱（選填）" outlined dense maxlength="190" @update:model-value="dirty = true" /></div>
        <div class="col-12 col-md-6"><q-select v-model="form.defaultCurrencyCode" :options="currencies" emit-value map-options clearable label="預設貨幣（選填）" outlined dense /></div>
        <div class="col-12 col-md-6"><q-input v-model="form.generalPhone" label="一般電話（選填）" outlined dense maxlength="50" /></div>
        <div class="col-12 col-md-6"><q-input v-model="form.generalEmail" label="一般電郵（選填）" type="email" outlined dense maxlength="254" /></div>
        <div class="col-12"><q-input v-model="form.website" label="網站（選填）" type="url" outlined dense maxlength="500" /></div>
        <div class="col-12"><q-input v-model="form.notes" label="備註（選填）" type="textarea" outlined dense maxlength="2000" autogrow /></div>
        <div v-if="approverRequired" class="col-12 col-md-6"><q-select v-model="approverUserId" :options="approvers.map((user) => ({ label: `${user.displayName} (${user.username})`, value: user.id }))" emit-value map-options label="審批人 *" outlined dense /></div>
      </div>
      <div class="row q-gutter-sm q-mt-lg">
        <q-btn color="secondary" label="儲存 Draft" aria-label="儲存 Draft" :loading="submitting" :disable="!form.customerCode.trim() || !form.legalName.trim()" @click="submit(false)" />
        <q-btn v-if="!approverRequired" color="primary" label="啟用或提交審批" aria-label="啟用或提交審批" :loading="submitting" :disable="!valid" @click="submit(true)" />
        <q-btn v-else color="primary" label="確認提交審批" aria-label="確認提交審批" :loading="submitting" :disable="!valid" @click="submit(true)" />
      </div>
    </main>
  </div>
</template>
