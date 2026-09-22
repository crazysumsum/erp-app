<script>
export const page = { name: "customer-detail", path: "/customers/:id", title: "客戶詳情", requires: { permissions: ["customer.view"] } };
</script>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import CustomerAddressPanel from "@/components/customers/CustomerAddressPanel.vue";
import CustomerBankPanel from "@/components/customers/CustomerBankPanel.vue";
import CustomerCompletenessBanner from "@/components/customers/CustomerCompletenessBanner.vue";
import CustomerContactPanel from "@/components/customers/CustomerContactPanel.vue";
import CustomerCreditPanel from "@/components/customers/CustomerCreditPanel.vue";
import CustomerIdentifierPanel from "@/components/customers/CustomerIdentifierPanel.vue";
import CustomerStatusActions from "@/components/customers/CustomerStatusActions.vue";
import { can } from "@/framework/authorization/can.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import customerService from "@/services/customer.js";
import { useSessionStore } from "@/stores/session.js";

const STATUS = Object.freeze({ draft: "草稿", pending_approval: "待審批", active: "啟用", suspended: "已暫停", blocked: "已封鎖", archived: "已封存" });
const route = useRoute(); const router = useRouter(); const session = useSessionStore(); const canManage = computed(() => can(session, { permissions: ["customer.mgmt"] })); const canApprove = computed(() => can(session, { permissions: ["customer.approval"] }));
const canRevealBank = computed(() => can(session, { permissions: ["customer.bank.view"] }));
const canManageBank = computed(() => can(session, { permissions: ["customer.view", "customer.bank.view", "customer.bank.mgmt"] }));
const customer = ref(null); const loading = ref(true); const error = ref(null); const editing = ref(false); const submitting = ref(false); const editError = ref(""); const stale = ref(false);
const completeness = ref({ issues: [], warnings: [] });
const tab = ref("overview");
const form = reactive({ legalName: "", tradingName: "", defaultCurrencyCode: null, defaultPaymentTermId: null, accountManagerUserId: null, categoryId: null, industryId: null, territoryId: null, generalPhone: "", generalEmail: "", website: "", notes: "", reason: "" });
const dirty = computed(() => editing.value && Object.entries(form).some(([key, value]) => key !== "reason" && value !== customer.value?.[key]));
onBeforeRouteLeave(() => !dirty.value || window.confirm("有未儲存的變更，確定要離開這一頁嗎？"));
function loadForm(value) { Object.assign(form, { legalName: value.legalName, tradingName: value.tradingName, defaultCurrencyCode: value.defaultCurrencyCode, defaultPaymentTermId: value.defaultPaymentTermId, accountManagerUserId: value.accountManagerUserId, categoryId: value.categoryId, industryId: value.industryId, territoryId: value.territoryId, generalPhone: value.generalPhone, generalEmail: value.generalEmail, website: value.website, notes: value.notes, reason: "" }); }
async function load() { loading.value = true; error.value = null; try { [customer.value, completeness.value] = await Promise.all([customerService.getById(Number(route.params.id)), customerService.completeness(Number(route.params.id))]); loadForm(customer.value); } catch (loadError) { error.value = loadError; } finally { loading.value = false; } }
function startEdit() { loadForm(customer.value); editError.value = ""; stale.value = false; editing.value = true; }
async function reloadLatest() { try { customer.value = await customerService.getById(Number(route.params.id)); loadForm(customer.value); stale.value = false; editError.value = ""; } catch (reloadError) { editError.value = reloadError.message || "載入最新資料失敗"; notifyError(editError.value); } }
async function save() { if (submitting.value || stale.value || form.reason.trim().length < 5) return; submitting.value = true; editError.value = ""; try { customer.value = (await customerService.update(customer.value.id, { ...form, reason: form.reason.trim(), version: customer.value.version })).customer; loadForm(customer.value); editing.value = false; notifySuccess(`客戶 ${customer.value.code} 的一般資料已更新`); } catch (saveError) { if (saveError.code === "VERSION_CONFLICT") { stale.value = true; editError.value = "此客戶已被其他人修改；你的輸入仍保留，請載入最新資料後再提交。"; } else editError.value = saveError.message || "更新失敗"; notifyError(editError.value); } finally { submitting.value = false; } }
onMounted(load);
</script>

<template>
  <div>
    <PageHeader :title="customer ? `${customer.code} — ${customer.legalName}` : '客戶詳情'" />
    <main class="q-pa-md" style="max-width: 1000px">
      <q-skeleton v-if="loading" type="rect" height="180px" aria-label="載入客戶詳情" />
      <q-banner v-else-if="error" class="bg-negative text-white" role="alert">{{ error.message || '載入客戶失敗' }}<template #action><q-btn v-if="error.code === 'CUSTOMER_NOT_FOUND'" flat label="返回客戶列表" to="/customers" /><q-btn v-else flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="customer">
        <div class="row items-center q-gutter-sm q-mb-md"><q-badge :color="customer.status === 'active' ? 'positive' : 'warning'" :label="STATUS[customer.status] ?? customer.status" /><span class="text-caption text-grey-7">版本 {{ customer.version }}</span><q-btn v-if="canManage && !editing && customer.status !== 'archived'" color="primary" label="編輯一般資料" aria-label="編輯一般資料" @click="startEdit" /><CustomerStatusActions v-if="!editing" :customer="customer" :can-manage="canManage" :can-approve="canApprove" :user-id="session.user?.id" :username="session.user?.username" @refresh="load" @deleted="router.push('/customers')" /></div>
        <q-banner v-if="editError" class="bg-negative text-white q-mb-md" role="alert">{{ editError }}<template v-if="stale" #action><q-btn flat label="載入最新資料" @click="reloadLatest" /></template></q-banner>
        <CustomerCompletenessBanner v-if="!editing" :completeness="completeness" />
        <q-tabs v-if="!editing" v-model="tab" align="left" dense active-color="primary"><q-tab name="overview" label="概覽" /><q-tab name="addresses" :label="`地址 (${customer.addresses.length})`" /><q-tab name="contacts" :label="`聯絡人 (${customer.contacts.length})`" /><q-tab name="identifiers" :label="`識別資料 (${customer.identifiers.length})`" /><q-tab name="credit" label="信用政策" /><q-tab name="banks" label="銀行帳戶" /></q-tabs>
        <q-tab-panels v-if="!editing" v-model="tab" animated><q-tab-panel name="overview"><q-list bordered separator>
          <q-item><q-item-section><q-item-label caption>交易名稱</q-item-label><q-item-label>{{ customer.tradingName || '—' }}</q-item-label></q-item-section></q-item>
          <q-item><q-item-section><q-item-label caption>預設貨幣</q-item-label><q-item-label>{{ customer.defaultCurrencyCode || '未設定' }}</q-item-label></q-item-section></q-item>
          <q-item><q-item-section><q-item-label caption>電話／電郵</q-item-label><q-item-label>{{ customer.generalPhone || '—' }}／{{ customer.generalEmail || '—' }}</q-item-label></q-item-section></q-item>
          <q-item><q-item-section><q-item-label caption>備註</q-item-label><q-item-label class="pre-line">{{ customer.notes || '—' }}</q-item-label></q-item-section></q-item>
        </q-list></q-tab-panel><q-tab-panel name="addresses"><CustomerAddressPanel :customer-id="customer.id" :addresses="customer.addresses" :can-manage="canManage && customer.status !== 'archived'" @refresh="load" /></q-tab-panel><q-tab-panel name="contacts"><CustomerContactPanel :customer-id="customer.id" :contacts="customer.contacts" :can-manage="canManage && customer.status !== 'archived'" @refresh="load" /></q-tab-panel><q-tab-panel name="identifiers"><CustomerIdentifierPanel :customer-id="customer.id" :identifiers="customer.identifiers" :can-manage="canManage && customer.status !== 'archived'" @refresh="load" /></q-tab-panel><q-tab-panel name="credit"><CustomerCreditPanel :customer-id="customer.id" :policy="customer.credit" :can-manage="canManage && customer.status !== 'archived'" @refresh="load" /></q-tab-panel><q-tab-panel name="banks"><CustomerBankPanel :customer-id="customer.id" :can-manage="canManageBank && customer.status !== 'archived'" :can-reveal="canRevealBank" /></q-tab-panel></q-tab-panels>
        <q-card v-else flat bordered><q-card-section><div class="row q-col-gutter-md"><div class="col-12 col-md-6"><q-input v-model="form.legalName" label="法定名稱 *" outlined dense maxlength="190" /></div><div class="col-12 col-md-6"><q-input v-model="form.tradingName" label="交易名稱" outlined dense maxlength="190" /></div><div class="col-12 col-md-6"><q-input v-model="form.generalPhone" label="一般電話" outlined dense maxlength="50" /></div><div class="col-12 col-md-6"><q-input v-model="form.generalEmail" label="一般電郵" outlined dense maxlength="254" /></div><div class="col-12"><q-input v-model="form.website" label="網站" outlined dense maxlength="500" /></div><div class="col-12"><q-input v-model="form.notes" label="備註" type="textarea" outlined dense maxlength="2000" autogrow /></div><div class="col-12"><q-input v-model="form.reason" label="修改原因 *" type="textarea" outlined dense maxlength="500" hint="最少 5 個字元；會寫入稽核記錄。" /></div></div></q-card-section><q-card-actions align="right"><q-btn flat label="取消" @click="editing = false" /><q-btn color="primary" label="儲存一般資料" aria-label="儲存一般資料" :loading="submitting" :disable="stale || form.reason.trim().length < 5" @click="save" /></q-card-actions></q-card>
      </template>
    </main>
  </div>
</template>

<style scoped>.pre-line { white-space: pre-line; }</style>
