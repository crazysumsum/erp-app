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
import { computed, nextTick, reactive, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SupplierAuditTimeline, { SUPPLIER_AUDIT_ACTIONS, SUPPLIER_AUDIT_TARGET_TYPES } from "@/components/suppliers/SupplierAuditTimeline.vue";

/**
 * Supplier 變更紀錄（設計 §7.2 `SupplierAuditPage`；DEF-035、HD-125 A）。日期以香港日界計，同供應商列表一樣。
 * 篩選：日期、操作者、對象（名稱／Code）、動作、對象類型；分頁同排序由後端定（最新先）。
 */
const ACTION_OPTIONS = [{ label: "全部", value: null }, ...Object.entries(SUPPLIER_AUDIT_ACTIONS).map(([value, label]) => ({ label, value }))];
const TARGET_TYPE_OPTIONS = [{ label: "全部", value: null }, ...Object.entries(SUPPLIER_AUDIT_TARGET_TYPES).map(([value, label]) => ({ label, value }))];

const form = reactive({ from: "", to: "", actor: "", target: "", action: null, targetType: null });
const timeline = ref(null);

const dayStart = (value) => (value ? new Date(`${value}T00:00:00+08:00`).getTime() : undefined);
const dayEnd = (value) => (value ? new Date(`${value}T23:59:59.999+08:00`).getTime() : undefined);
const rangeError = computed(() => (form.from && form.to && form.from > form.to ? "結束日期不可早於開始日期" : ""));
const filters = computed(() => ({
  from: dayStart(form.from), to: dayEnd(form.to), actor: form.actor?.trim() ?? "", target: form.target?.trim() ?? "",
  action: form.action, targetType: form.targetType
}));

// 日期範圍錯咗就唔查，等用戶改好先（同供應商列表一樣顯示錯誤）。等 nextTick：新篩選要先傳到 timeline 嘅 prop，
// 否則會用上一次嘅篩選查。
async function reload() {
  if (rangeError.value) return;
  await nextTick();
  timeline.value?.reload();
}
</script>

<template>
  <div>
    <PageHeader />
    <div class="row items-start q-gutter-md q-px-md q-pb-md">
      <q-input v-model="form.from" dense outlined type="date" label="由" stack-label style="width: 170px" @update:model-value="reload" />
      <q-input v-model="form.to" dense outlined type="date" label="至" stack-label style="width: 170px" :error="Boolean(rangeError)"
        :error-message="rangeError" @update:model-value="reload" />
      <q-input v-model="form.actor" dense outlined clearable debounce="300" label="操作者" maxlength="190" style="width: 170px" @update:model-value="reload" />
      <q-input v-model="form.target" dense outlined clearable debounce="300" label="對象" maxlength="190" style="width: 170px" @update:model-value="reload" />
      <q-select v-model="form.action" dense outlined emit-value map-options :options="ACTION_OPTIONS" label="動作" style="width: 200px" @update:model-value="reload" />
      <q-select v-model="form.targetType" dense outlined emit-value map-options :options="TARGET_TYPE_OPTIONS" label="對象類型" style="width: 170px" @update:model-value="reload" />
    </div>
    <div class="q-px-md q-pb-md">
      <SupplierAuditTimeline ref="timeline" :filters="filters" />
    </div>
  </div>
</template>
