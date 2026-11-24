<script>
export const page = { name: "ap-invoice-create", path: "/ap/invoices/new", title: "登記應付發票", requires: { permissions: ["ap.view", "ap.invoice.mgmt"] } };
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ApCurrencyPicker from "@/components/ap/ApCurrencyPicker.vue";
import ApExpenseRows from "@/components/ap/ApExpenseRows.vue";
import ApSupplierPicker from "@/components/ap/ApSupplierPicker.vue";
import { amountInputValid, today } from "@/components/ap/apPresentation.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";
import purchasing from "@/services/purchasing.js";

const router = useRouter(), session = useSessionStore();
const command = useCommandEvent();
const canReadReceipts = computed(() => session.permissions.includes("purchasing.view"));
const canSearchSuppliers = computed(() => session.permissions.includes("supplier.view"));
const mode = ref(canReadReceipts.value ? "receipt" : "expense");
const key = computed(() => `${session.user?.id}:ap-invoice-create`);
const receiptSupplier = ref(null), expenseSupplier = ref(null);
const filter = reactive({ purchaseOrderId: "" });
const form = reactive({ currencyCode: "", supplierInvoiceNumber: "", invoiceDate: today(), dueDate: "",
  dueDateReason: "", supplierTotalAmount: "", noPoReason: "", notes: "" });
const expenses = ref([]);
const receipts = ref([]), selected = reactive(new Map()), invoiced = ref(new Map());
const pageNumber = ref(1), total = ref(0), loadedFilters = ref({});
const searched = ref(false), loading = ref(false), lookupError = ref(""), error = ref(""), alert = ref(null);
const pageSize = 20;
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const selectedParty = computed(() => selected.values().next().value);
const uncertain = computed(() => command.isUncertain(key.value));
const busy = computed(() => command.isBusy(key.value));
const locked = computed(() => uncertain.value || busy.value);
let controller;
onBeforeUnmount(() => controller?.abort());
watch(mode, () => { error.value = ""; });
watch(expenseSupplier, (row) => { form.currencyCode = row?.defaultCurrencyCode ?? ""; });

async function find(page = 1, fromForm = false) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  loading.value = true; lookupError.value = ""; searched.value = true;
  if (fromForm) loadedFilters.value = { ...filter, supplierId: canSearchSuppliers.value ? receiptSupplier.value?.id : undefined };
  try {
    const { rows, rowsNumber } = await purchasing.listGoodsReceipts({ ...loadedFilters.value, page, rowsPerPage: pageSize, status: "CONFIRMED", signal });
    const hits = await ap.listInvoicedReceipts(rows.map(({ id }) => id), { signal });
    if (signal.aborted) return;
    receipts.value = rows;
    total.value = rowsNumber;
    pageNumber.value = page;
    invoiced.value = new Map(hits.map((row) => [row.goodsReceiptId, row]));
    for (const row of hits) selected.delete(row.goodsReceiptId);
  } catch (failure) {
    if (!signal.aborted) lookupError.value = failure.message || "載入已確認收貨失敗。";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function blocked(row) {
  if (invoiced.value.has(String(row.id))) return "已在有效發票上";
  if (selectedParty.value && row.supplierId !== selectedParty.value.supplierId) return "供應商不同";
  if (selectedParty.value && row.currencyCode !== selectedParty.value.currencyCode) return "幣別不同";
  if (!selected.has(String(row.id)) && selected.size >= 20) return "已選 20 張";
  return "";
}

function toggle(row, on) {
  const id = String(row.id);
  if (on) selected.set(id, row);
  else selected.delete(id);
}

async function showError(message) {
  error.value = message;
  await nextTick();
  alert.value?.focus();
}

async function submit() {
  const pending = command.pending(key.value);
  const fromReceipts = mode.value === "receipt";
  const supplierId = expenseSupplier.value?.id, currencyCode = form.currencyCode;
  error.value = "";
  if (!pending) {
    if (fromReceipts && !selected.size) return showError("請選至少一張同供應商、同幣別的已確認收貨。");
    if (!fromReceipts && !canSearchSuppliers.value) return showError("登記無採購單發票需要「查看供應商」權限。");
    if (!fromReceipts && (!supplierId || !currencyCode)) return showError("請選擇供應商和幣別。");
    if (!fromReceipts && (!form.noPoReason.trim() || !expenses.value.length)) return showError("無採購單發票須填原因，並至少有一個費用行。");
    if (form.supplierTotalAmount && !amountInputValid(form.supplierTotalAmount, 4, true)) return showError("請核對供應商發票總額格式。");
    if (expenses.value.some((row) => !row.description.trim() || !amountInputValid(row.lineAmount, 4))) return showError("每個費用行須有說明和正數金額。");
  }
  const payload = pending?.payload ?? {
    supplierInvoiceNumber: form.supplierInvoiceNumber.trim(), invoiceDate: form.invoiceDate,
    ...(fromReceipts ? { goodsReceiptIds: [...selected.keys()] } : { supplierId, currencyCode, noPoReason: form.noPoReason.trim() }),
    ...(form.dueDate ? { dueDate: form.dueDate, dueDateReason: form.dueDateReason.trim() } : {}),
    ...(form.supplierTotalAmount ? { supplierTotalAmount: form.supplierTotalAmount } : {}),
    notes: form.notes,
    expenses: expenses.value.map(({ description, lineAmount }) => ({ description, lineAmount }))
  };
  try {
    const result = await command.run(payload, (body) => ap.createInvoice(body), key.value, { action: "create" });
    notifySuccess("已建立應付發票草稿。");
    await router.push(`/ap/invoices/${result.id}`);
  } catch (failure) {
    if (command.isUncertain(key.value)) return;
    await showError(failure.message || "建立應付發票失敗。");
    if (failure.code === "AP_RECEIPT_ALREADY_INVOICED") await find(pageNumber.value);
  }
}
</script>

<template>
  <div>
    <PageHeader>
      <template #actions><q-btn flat label="返回發票列表" to="/ap/invoices" /></template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">
        發票草稿的結果尚未確認。
        <template #action><q-btn flat label="重試原操作" :loading="busy" @click="submit" /></template>
      </q-banner>
      <fieldset v-if="canReadReceipts" class="q-mb-md" :disabled="locked">
        <legend>開票來源</legend>
        <label class="q-mr-lg"><input v-model="mode" type="radio" name="source" value="receipt" /> 由收貨開票</label>
        <label><input v-model="mode" type="radio" name="source" value="expense" /> 無採購單發票</label>
      </fieldset>
      <template v-if="mode === 'receipt'">
        <form role="search" method="get" class="row items-start q-gutter-md q-mb-md" @submit.prevent="find(1, true)">
            <ApSupplierPicker v-if="canSearchSuppliers" v-model="receiptSupplier" label="篩選供應商" :disable="locked" class="col-12 col-sm-4" />
            <q-input v-model="filter.purchaseOrderId" name="purchaseOrderId" label="篩選採購單 ID" inputmode="numeric" pattern="[1-9][0-9]*" :disable="locked" outlined dense />
            <q-btn type="submit" label="搜尋已確認收貨" flat :loading="loading" :disable="locked" />
        </form>
        <p v-if="!canSearchSuppliers" class="text-grey-8">依供應商篩選需要「查看供應商」權限。</p>
        <div aria-live="polite" class="q-mb-md">
          <p v-if="loading" role="status">載入收貨中…</p>
          <q-banner v-else-if="lookupError" role="alert" class="bg-negative text-white">{{ lookupError }}<template #action><q-btn flat label="重試" @click="find(pageNumber)" /></template></q-banner>
          <p v-else-if="searched && !receipts.length" role="status">沒有符合條件的已確認收貨。</p>
          <q-list v-else-if="receipts.length" bordered separator>
            <q-item v-for="row in receipts" :key="row.id" tag="label">
              <q-item-section side><q-checkbox :model-value="selected.has(String(row.id))" :aria-label="`選擇 ${row.number}`" :disable="locked || Boolean(blocked(row))" @update:model-value="toggle(row, $event)" /></q-item-section>
              <q-item-section>
                <q-item-label>{{ row.number }} · {{ row.supplierCode }} {{ row.supplierName }}</q-item-label>
                <q-item-label caption>{{ row.purchaseOrderNumber }} · {{ row.businessReceiptDate }} · {{ row.currencyCode }}</q-item-label>
              </q-item-section>
              <q-item-section v-if="blocked(row)" side>{{ blocked(row) }}</q-item-section>
            </q-item>
          </q-list>
          <div v-if="pages > 1" class="row items-center q-mt-sm">
            <q-btn flat label="上一頁" :disable="locked || loading || pageNumber === 1" @click="find(pageNumber - 1)" />
            <span>{{ pageNumber }}／{{ pages }}</span>
            <q-btn flat label="下一頁" :disable="locked || loading || pageNumber >= pages" @click="find(pageNumber + 1)" />
          </div>
          <p role="status" class="q-mt-sm">已選 {{ selected.size }} 張收貨（最多 20 張）{{ selectedParty ? ` · ${selectedParty.supplierCode} · ${selectedParty.currencyCode}` : "" }}</p>
          <div v-if="selected.size" class="row q-gutter-xs">
            <q-btn v-for="[receiptId, receipt] in selected" :key="receiptId" flat dense icon="close" :label="receipt.number"
              :aria-label="`移除已選的 ${receipt.number}`" :disable="locked" @click="selected.delete(receiptId)" />
          </div>
        </div>
      </template>
      <p v-if="mode === 'expense' && !canSearchSuppliers" role="status">登記無採購單發票需要「查看供應商」權限。</p>
      <form v-else method="post" @submit.prevent="submit">
        <fieldset class="q-pa-md q-mb-md" :disabled="locked">
          <legend>發票資料</legend>
          <div class="row q-col-gutter-md">
            <template v-if="mode === 'expense'">
              <div class="col-12 col-sm-6"><ApSupplierPicker v-model="expenseSupplier" active-only :disable="locked" /></div>
              <div class="col-12 col-sm-6"><ApCurrencyPicker v-model="form.currencyCode" :disable="locked || !expenseSupplier" /></div>
              <div class="col-12"><q-input v-model="form.noPoReason" label="無採購單原因" name="noPoReason" maxlength="500" outlined dense required /></div>
            </template>
            <div class="col-12 col-sm-6"><q-input v-model="form.supplierInvoiceNumber" label="供應商發票號碼" name="supplierInvoiceNumber" maxlength="100" outlined dense required /></div>
            <div class="col-12 col-sm-6"><q-input v-model="form.supplierTotalAmount" label="供應商發票總額" name="supplierTotalAmount" inputmode="decimal" hint="確認發票前須核對總額" outlined dense /></div>
            <div class="col-12 col-sm-6"><q-input v-model="form.invoiceDate" label="發票日期" name="invoiceDate" type="date" stack-label :max="today()" outlined dense required /></div>
            <div class="col-12 col-sm-6"><q-input v-model="form.dueDate" label="到期日" name="dueDate" type="date" stack-label :min="form.invoiceDate" :required="mode === 'expense'" :hint="mode === 'receipt' ? '可留空，按共同採購條款計算' : ''" outlined dense /></div>
            <div v-if="mode === 'receipt'" class="col-12"><q-input v-model="form.dueDateReason" label="到期日原因" name="dueDateReason" hint="與條款計算日期不同時必填" maxlength="500" outlined dense /></div>
            <div class="col-12"><q-input v-model="form.notes" label="備註" name="notes" type="textarea" maxlength="2000" outlined dense /></div>
          </div>
        </fieldset>
        <ApExpenseRows v-model="expenses" :locked="locked" />
        <div v-if="error" ref="alert" role="alert" tabindex="-1" class="text-negative q-mb-md">{{ error }}</div>
        <q-btn color="primary" type="submit" label="建立應付發票草稿" :loading="busy" :disable="locked" />
      </form>
    </div>
  </div>
</template>
