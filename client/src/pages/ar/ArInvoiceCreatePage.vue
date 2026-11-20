<script>
export const page = { name: "ar-invoice-create", path: "/ar/invoices/new", title: "由出貨開立發票", requires: { permissions: ["ar.view", "ar.invoice.mgmt", "fulfillment.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { today } from "@/components/ar/arPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ar from "@/services/ar.js";
import shipment from "@/services/shipment.js";

const MAX_SHIPMENTS = 20;
const router = useRouter(), session = useSessionStore();
const command = useCommandEvent();
const key = computed(() => `${session.user?.id}:ar-invoice-create`);
const search = reactive({ customerId: "", q: "", shipmentDateFrom: "", shipmentDateTo: "" });
const form = reactive({ invoiceDate: today(), dueDate: "", dueDateReason: "", notes: "" });
const shipments = ref([]), invoiced = ref(new Map()), selected = ref([]);
const loading = ref(false), loadError = ref(""), submitError = ref(""), searched = ref(false);
const uncertain = computed(() => command.isUncertain(key.value));
const busy = computed(() => command.isBusy(key.value));
const locked = computed(() => uncertain.value || busy.value);

let controller;
onBeforeUnmount(() => controller?.abort());
// 只列 SHIPPED（契約：整張出貨開票）；再問 AR 邊啲已經喺有效發票上。
async function find() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loading.value = true; loadError.value = ""; searched.value = true;
  try {
    const query = Object.fromEntries(Object.entries({ ...search, status: "SHIPPED", pageSize: 100 }).filter(([, value]) => value !== ""));
    const { items } = await shipment.listShipments({ ...query, signal });
    const marks = await ar.listInvoicedShipments(items.map((row) => row.id), { signal });
    if (signal.aborted) return;
    shipments.value = items;
    invoiced.value = new Map(marks.map((mark) => [String(mark.shipmentId), mark]));
    selected.value = selected.value.filter((id) => items.some((row) => row.id === id) && !invoiced.value.has(id));
  } catch (failure) {
    if (!signal.aborted) loadError.value = failure.message || "載入出貨失敗";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
const customerOf = (id) => shipments.value.find((row) => row.id === id)?.customer;
const selectedCustomer = computed(() => (selected.value.length ? customerOf(selected.value[0]) : null));
// 一張發票只可以係同一客戶；幣別由 server 驗（出貨列表冇幣別）。
function blockedReason(row) {
  if (invoiced.value.has(row.id)) return `已在發票 ${invoiced.value.get(row.id).invoiceNumber || "（草稿）"}`;
  if (selectedCustomer.value && row.customer.id !== selectedCustomer.value.id) return "不同客戶";
  if (!selected.value.includes(row.id) && selected.value.length >= MAX_SHIPMENTS) return `最多 ${MAX_SHIPMENTS} 張`;
  return "";
}
function toggle(id, on) { selected.value = on ? [...selected.value, id] : selected.value.filter((value) => value !== id); }

const optional = (value) => (value.trim() ? value.trim() : undefined);
async function submit() {
  submitError.value = "";
  const payload = Object.fromEntries(Object.entries({ shipmentIds: selected.value.map(Number), invoiceDate: form.invoiceDate || undefined,
    dueDate: form.dueDate || undefined, dueDateReason: optional(form.dueDateReason), notes: optional(form.notes) }).filter(([, value]) => value !== undefined));
  try {
    const result = await command.run(payload, (body) => ar.createInvoice(body), key.value, { action: "create" });
    notifySuccess("已建立發票草稿；請核對後確認。");
    await router.push(`/ar/invoices/${result.id}`);
  } catch (failure) {
    if (command.isUncertain(key.value)) return;
    submitError.value = failure.message || "建立發票失敗";
    if (failure.code === "AR_SHIPMENT_ALREADY_INVOICED") await find();
  }
}
// 未確定：用原 record（同一 eventId、同一內容）重送。
const retry = () => submit();
</script>

<template>
  <div>
    <PageHeader subtitle="選同一客戶、已出貨的出貨單（最多 20 張）。整張出貨開票，不拆數量；建立後是草稿，要確認才取號。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md" data-testid="ar-create-uncertain">
        建立發票的結果尚未確認；請重試同一操作以確認結果，不會重複建立。期間不能修改選擇。
        <template #action><q-btn flat label="重試確認結果" :loading="busy" @click="retry" /></template>
      </q-banner>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-6 col-md-3"><q-input v-model="search.customerId" label="客戶 ID" mask="################" :disable="locked" outlined dense @keyup.enter="find" /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-input v-model="search.q" label="出貨單／銷售單／客戶" maxlength="190" :disable="locked" outlined dense @keyup.enter="find" /></div>
        <div class="col-6 col-md-3"><q-input v-model="search.shipmentDateFrom" label="出貨日期由" type="date" stack-label :disable="locked" outlined dense /></div>
        <div class="col-6 col-md-3"><q-input v-model="search.shipmentDateTo" label="出貨日期至" type="date" stack-label :disable="locked" outlined dense /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="搜尋已出貨" color="primary" :loading="loading" :disable="locked" @click="find" /><q-btn flat label="返回發票列表" to="/ar/invoices" /></div>
    </div>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <q-banner v-if="loadError" role="alert" class="bg-negative text-white">{{ loadError }}<template #action><q-btn flat label="重試" @click="find" /></template></q-banner>
      <p v-else-if="searched && !loading && !shipments.length" role="status">沒有符合條件的已出貨出貨單。</p>
      <q-list v-else-if="shipments.length" bordered separator>
        <q-item v-for="row in shipments" :key="row.id" tag="label" :disable="locked || Boolean(blockedReason(row))" data-testid="ar-create-shipment">
          <q-item-section side><q-checkbox :model-value="selected.includes(row.id)" :disable="locked || Boolean(blockedReason(row))" :aria-label="`選擇 ${row.number}`" @update:model-value="(on) => toggle(row.id, on)" /></q-item-section>
          <q-item-section>
            <q-item-label>{{ row.number }} — {{ row.customer.code }} {{ row.customer.name }}</q-item-label>
            <q-item-label caption>銷售單 {{ row.salesOrder.number }}，出貨日期 {{ row.shipmentDate || "—" }}，{{ row.lineCount }} 行</q-item-label>
          </q-item-section>
          <q-item-section v-if="blockedReason(row)" side><q-item-label caption>{{ blockedReason(row) }}</q-item-label></q-item-section>
        </q-item>
      </q-list>
    </div>
    <div class="q-px-md q-pb-md">
      <h2 class="text-h6 q-ma-none q-mb-md">發票資料</h2>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-6 col-md-3"><q-input v-model="form.invoiceDate" label="發票日期" type="date" stack-label :max="today()" :disable="locked" outlined dense /></div>
        <div class="col-12 col-sm-6 col-md-3"><q-input v-model="form.dueDate" label="到期日（留空按付款條款）" type="date" stack-label :disable="locked" outlined dense /></div>
        <div class="col-12 col-md-6"><q-input v-model="form.dueDateReason" label="到期日原因（與條款不同時必填）" maxlength="500" :disable="locked" outlined dense /></div>
        <div class="col-12"><q-input v-model="form.notes" label="備註" type="textarea" maxlength="2000" autogrow :disable="locked" outlined dense /></div>
      </div>
      <q-banner v-if="submitError" role="alert" class="bg-negative text-white q-mt-md">{{ submitError }}</q-banner>
      <div class="row items-center q-gutter-sm q-mt-md">
        <q-btn color="primary" label="建立發票草稿" :loading="busy" :disable="!selected.length || locked" @click="submit" />
        <span>已選 {{ selected.length }} 張{{ selectedCustomer ? `（${selectedCustomer.code} ${selectedCustomer.name}）` : "" }}</span>
      </div>
    </div>
  </div>
</template>
