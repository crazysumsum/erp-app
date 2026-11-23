<script>
export const page = { name: "ar-aging", path: "/ar/aging", title: "應收帳齡", requires: { permissions: ["ar.view"] }, menu: { group: "accountsReceivable", icon: "hourglass_bottom", order: 30 } };
</script>
<script setup>
import { onBeforeUnmount, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { money } from "@/components/ar/arPresentation.js";
import ar from "@/services/ar.js";

const route = useRoute(), router = useRouter();
const filters = reactive({ customerId: "", currencyCode: "" });
const report = ref(null), loading = ref(false), error = ref("");
const BUCKETS = [["notDue", "未到期"], ["days1To30", "逾期 1–30 日"], ["days31To60", "逾期 31–60 日"], ["days61To90", "逾期 61–90 日"], ["over90", "逾期 90 日以上"], ["total", "合計"]];

let controller;
onBeforeUnmount(() => controller?.abort());
async function load() {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const query = Object.fromEntries(["customerId", "currencyCode"].map((key) => [key, route.query[key] ?? ""]).filter(([, value]) => value !== ""));
  Object.assign(filters, { customerId: "", currencyCode: "", ...query });
  loading.value = true; error.value = "";
  try {
    const value = await ar.getAging({ ...query, signal });
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
    <PageHeader subtitle="今日現況：按到期日的逾期日數分桶，只計已確認而仍有未收額的發票。不同幣別分開合計，不可相加；未核銷的收款餘額不在此表。" />
    <div class="q-px-md q-pb-md">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-6 col-md-4"><q-input v-model="filters.customerId" label="客戶 ID" hint="數字 ID" mask="################" outlined dense @keyup.enter="apply" /></div>
        <div class="col-12 col-sm-6 col-md-4"><q-input v-model="filters.currencyCode" label="貨幣代碼" hint="例如 HKD" mask="AAA" outlined dense @keyup.enter="apply" /></div>
      </div>
      <div class="row q-gutter-sm q-mt-md"><q-btn label="查詢" color="primary" @click="apply" /><q-btn flat label="清除篩選" @click="reset" /></div>
    </div>
    <div class="q-px-md q-pb-md" aria-live="polite">
      <q-skeleton v-if="loading" type="rect" aria-label="載入帳齡表" />
      <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="report">
        <p>截至 {{ report.asOfDate }}</p>
        <p v-if="!report.items.length" role="status">沒有未收的應收款。</p>
        <q-markup-table v-else flat bordered separator="cell" class="q-mb-md">
          <thead><tr><th class="text-left">客戶</th><th class="text-left">幣別</th><th class="text-right">發票數</th><th v-for="[key, label] in BUCKETS" :key="key" class="text-right">{{ label }}</th></tr></thead>
          <tbody>
            <tr v-for="row in report.items" :key="`${row.customerId}:${row.currencyCode}`" data-testid="ar-aging-row">
              <td>{{ row.customerCode }} — {{ row.customerName }}</td><td>{{ row.currencyCode }}</td><td class="text-right">{{ row.invoiceCount }}</td>
              <td v-for="[key] in BUCKETS" :key="key" class="text-right">{{ money(row[key], row.currencyDecimalPlaces) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-for="total in report.totals" :key="total.currencyCode" data-testid="ar-aging-total">
              <th class="text-left" colspan="2">{{ total.currencyCode }} 合計</th><th class="text-right">{{ total.invoiceCount }}</th>
              <th v-for="[key] in BUCKETS" :key="key" class="text-right">{{ money(total[key], report.items.find((row) => row.currencyCode === total.currencyCode)?.currencyDecimalPlaces ?? 4) }}</th>
            </tr>
          </tfoot>
        </q-markup-table>
      </template>
    </div>
  </div>
</template>
