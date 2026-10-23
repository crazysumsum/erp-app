<script>
export const page = {
  name: "supplierAudit",
  path: "/suppliers/audit",
  title: "變更紀錄",
  requires: { permissions: ["supplier.view"] },
  menu: { group: "suppliers", icon: "history", order: 80 }
};
</script>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SupplierAuditTimeline, { SUPPLIER_AUDIT_ACTIONS, SUPPLIER_AUDIT_TARGET_TYPES } from "@/components/suppliers/SupplierAuditTimeline.vue";
import appConfig from "@config/app.js";

/**
 * Supplier 變更紀錄（設計 §7.2 `SupplierAuditPage`；DEF-035、HD-125 A）。日期以香港日界計，同供應商列表一樣。
 * 篩選同頁數放喺 URL：重新整理或者分享連結都還原得返（UAT-055；REV-113 M-2）。篩選一改就由第 1 頁再查（L-4）。
 */
const ACTION_OPTIONS = [{ label: "全部", value: null }, ...Object.entries(SUPPLIER_AUDIT_ACTIONS).map(([value, label]) => ({ label, value }))];
const TARGET_TYPE_OPTIONS = [{ label: "全部", value: null }, ...Object.entries(SUPPLIER_AUDIT_TARGET_TYPES).map(([value, label]) => ({ label, value }))];

const route = useRoute();
const router = useRouter();

// 要係真嘅日子：未打完嘅年份（0002-10-01）或者 2026-02-31 唔查（REV-113 L-3），同列表一樣。
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value < "1970-01-02") return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const text = (value) => (typeof value === "string" ? value.slice(0, 190) : "");
const positive = (value, fallback) => (/^[1-9]\d{0,5}$/u.test(String(value ?? "")) ? Number(value) : fallback);

const query = route.query;
const form = reactive({
  from: validDate(query.from) ? query.from : "",
  to: validDate(query.to) ? query.to : "",
  actor: text(query.actor),
  target: text(query.target),
  action: Object.hasOwn(SUPPLIER_AUDIT_ACTIONS, query.action) ? query.action : null,
  targetType: Object.hasOwn(SUPPLIER_AUDIT_TARGET_TYPES, query.targetType) ? query.targetType : null
});
const pageSizes = appConfig.pageSizeOptions;
const rowsPerPage = positive(query.pageSize, appConfig.defaultPageSize);
const pagination = ref({ page: positive(query.page, 1), rowsPerPage: pageSizes.includes(rowsPerPage) ? rowsPerPage : appConfig.defaultPageSize,
  rowsNumber: 0, sortBy: null, descending: false });

const dayStart = (value) => (value ? new Date(`${value}T00:00:00+08:00`).getTime() : undefined);
const dayEnd = (value) => (value ? new Date(`${value}T23:59:59.999+08:00`).getTime() : undefined);
const rangeError = computed(() => (form.from && form.to && form.from > form.to ? "結束日期不可早於開始日期" : ""));
const datesReady = computed(() => (!form.from || validDate(form.from)) && (!form.to || validDate(form.to)));

const current = () => ({ from: dayStart(form.from), to: dayEnd(form.to), actor: form.actor?.trim() ?? "", target: form.target?.trim() ?? "",
  action: form.action, targetType: form.targetType });
const applied = ref(current());
const tableKey = ref(0);

// 日期未打完或者範圍倒轉就唔查，保留上一次嘅結果；其餘一改就由第 1 頁重新查。
watch(form, () => {
  if (!datesReady.value || rangeError.value) return;
  applied.value = current();
  pagination.value = { ...pagination.value, page: 1 };
  tableKey.value += 1;
});

function syncUrl({ page, rowsPerPage: size }) {
  pagination.value = { ...pagination.value, page, rowsPerPage: size };
  router.replace({ query: Object.fromEntries(Object.entries({
    from: form.from, to: form.to, actor: form.actor?.trim(), target: form.target?.trim(), action: form.action, targetType: form.targetType,
    page: String(page), pageSize: String(size)
  }).filter(([, value]) => value)) });
}
</script>

<template>
  <div>
    <PageHeader />
    <div class="row items-start q-gutter-md q-px-md q-pb-md">
      <q-input v-model="form.from" dense outlined type="date" label="由" stack-label style="width: 170px" />
      <q-input v-model="form.to" dense outlined type="date" label="至" stack-label style="width: 170px" :error="Boolean(rangeError)"
        :error-message="rangeError" />
      <q-input v-model="form.actor" dense outlined clearable debounce="300" label="操作者" maxlength="190" style="width: 170px" />
      <q-input v-model="form.target" dense outlined clearable debounce="300" label="對象" maxlength="190" style="width: 170px" />
      <q-select v-model="form.action" dense outlined emit-value map-options :options="ACTION_OPTIONS" label="動作" style="width: 200px" />
      <q-select v-model="form.targetType" dense outlined emit-value map-options :options="TARGET_TYPE_OPTIONS" label="對象類型" style="width: 170px" />
    </div>
    <div class="q-px-md q-pb-md">
      <SupplierAuditTimeline :key="tableKey" :filters="applied" :initial-pagination="pagination" @request="syncUrl" />
    </div>
  </div>
</template>
