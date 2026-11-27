<script>
export const page = { name: "ap-aging", path: "/ap/aging", title: "應付帳齡", requires: { permissions: ["ap.view"] }, menu: { group: "accountsPayable", icon: "hourglass_bottom", order: 30 } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import ApSupplierPicker from "@/components/ap/ApSupplierPicker.vue";
import { money } from "@/components/ap/apPresentation.js";
import { useSessionStore } from "@/stores/session.js";
import ap from "@/services/ap.js";

const route = useRoute(), router = useRouter(), session = useSessionStore();
const canPay = computed(() => session.permissions.includes("ap.payment.mgmt"));
const canSearchSuppliers = computed(() => session.permissions.includes("supplier.view"));
const filters = reactive({ supplierId: "", currencyCode: "" });
const report = ref(null), loading = ref(false), error = ref("");
const chosenSupplier = ref(null);
const supplierSelection = computed({
  get() {
    const id = filters.supplierId;
    if (!id) return null;
    if (String(chosenSupplier.value?.id) === id) return chosenSupplier.value;
    const row = report.value?.items.find((item) => String(item.supplierId) === id);
    return { id, supplierCode: row?.supplierCode, supplierName: row?.supplierName ?? "已套用供應商" };
  },
  set(row) {
    chosenSupplier.value = row;
    filters.supplierId = row ? String(row.id) : "";
  }
});
const BUCKETS = [["notDue", "未到期"], ["days1To30", "逾期 1–30 日"], ["days31To60", "逾期 31–60 日"], ["days61To90", "逾期 61–90 日"], ["over90", "逾期 90 日以上"], ["total", "合計"]];

let controller;
onBeforeUnmount(() => controller?.abort());
async function load() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const query = Object.fromEntries(["supplierId", "currencyCode"].map((key) => [key, route.query[key] ?? ""]).filter(([, value]) => value !== ""));
  Object.assign(filters, { supplierId: "", currencyCode: "", ...query });
  loading.value = true; error.value = "";
  try {
    const value = await ap.getAging({ ...query, signal });
    if (!signal.aborted) report.value = value;
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message || "載入帳齡表失敗";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch(() => JSON.stringify(route.query), load, { immediate: true });
function apply() { router.replace({ query: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "")) }); }
function reset() { router.replace({ query: {} }); }
</script>

<template>
  <div>
    <PageHeader subtitle="今日現況：按到期日的逾期日數分桶，只計已確認而仍有未付額的發票。不同幣別分開合計，不可相加；未核銷的付款餘額不在此表。" />
    <form role="search" method="get" class="q-px-md q-pb-md" @submit.prevent="apply">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-6 col-md-4">
          <ApSupplierPicker v-if="canSearchSuppliers" v-model="supplierSelection" label="供應商" />
          <q-input v-else v-model="filters.supplierId" label="供應商 ID" hint="數字 ID" mask="################" outlined dense />
        </div>
        <div class="col-12 col-sm-6 col-md-4"><q-input v-model="filters.currencyCode" label="貨幣代碼" hint="例如 HKD" mask="AAA" outlined dense /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="查詢" color="primary" type="submit" /><q-btn flat label="清除篩選" @click="reset" /></div>
    </form>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <q-skeleton v-if="loading" type="rect" aria-label="載入帳齡表" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="report">
        <p>截至 {{ report.asOfDate }}</p>
        <p v-if="!report.items.length" role="status">沒有未付的應付發票。</p>
        <div v-else role="region" aria-label="應付帳齡表" tabindex="0" class="aging-table q-mb-md">
        <q-markup-table flat bordered separator="cell">
          <thead><tr><th scope="col" class="text-left">供應商</th><th scope="col" class="text-left">幣別</th><th scope="col" class="text-right">發票數</th><th v-for="[key, label] in BUCKETS" :key="key" scope="col" class="text-right">{{ label }}</th><th v-if="canPay" scope="col">操作</th></tr></thead>
          <tbody>
            <tr v-for="row in report.items" :key="`${row.supplierId}:${row.currencyCode}`" data-testid="ap-aging-row">
              <th scope="row" class="text-left">{{ row.supplierCode }} — {{ row.supplierName }}</th><td>{{ row.currencyCode }}</td><td class="text-right">{{ row.invoiceCount }}</td>
              <td v-for="[key] in BUCKETS" :key="key" class="text-right">{{ money(row[key], row.currencyDecimalPlaces) }}</td>
              <td v-if="canPay"><q-btn flat dense label="登記付款" :to="{ name: 'ap-payment-create', query: { supplierId: row.supplierId, currencyCode: row.currencyCode } }" /></td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-for="total in report.totals" :key="total.currencyCode" data-testid="ap-aging-total">
              <th class="text-left" colspan="2">{{ total.currencyCode }} 合計</th><th class="text-right">{{ total.invoiceCount }}</th>
              <th v-for="[key] in BUCKETS" :key="key" class="text-right">{{ money(total[key], report.items.find((row) => row.currencyCode === total.currencyCode)?.currencyDecimalPlaces ?? 4) }}</th>
              <td v-if="canPay" />
            </tr>
          </tfoot>
        </q-markup-table>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.aging-table { overflow: auto; max-inline-size: 100%; }
</style>
