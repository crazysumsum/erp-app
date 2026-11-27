<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import { useSessionStore } from "@/stores/session.js";
import { can } from "@/framework/authorization/can.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import returns from "@/services/returns.js";
import ReturnDraftForm from "./ReturnDraftForm.vue";

const props = defineProps({ kind: { type: String, required: true }, id: { type: String, default: "" } });
const customer = props.kind === "customer";
const base = `/${props.kind}-returns`;
const resource = customer ? "出貨單" : "收貨單";
const title = customer ? "客戶退貨" : "退回供應商";
const sourceNumber = row => customer ? row.shipmentNumber : row.goodsReceiptNumber;
const session = useSessionStore();
const canWrite = computed(() => can(session, { permissions: [`returns.${props.kind}.mgmt`] }));
const creating = props.id === "new";
const detail = ref(null), error = ref(""), loading = ref(false);
const command = useCommandEvent();
const status = ref(null), tableKey = ref(0);
const labels = { DRAFT: "草稿", POSTED: "已過帳", CANCELLED: "已取消" };
const stock = { AVAILABLE: "可用", QUARANTINED: "隔離", DAMAGED: "損壞" };
const statuses = Object.entries(labels).map(([value, label]) => ({ value, label }));
const columns = [
  { name: "returnNumber", field: "returnNumber", label: "退貨單號", align: "left" },
  { name: "status", field: row => labels[row.status], label: "狀態", align: "left" },
  { name: "source", field: sourceNumber, label: resource, align: "left" },
  { name: "party", field: "partyName", label: customer ? "客戶" : "供應商", align: "left" },
  { name: "returnDate", field: "returnDate", label: "退貨日期", align: "left" }
];
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const fetchRows = ({ page, rowsPerPage }) => returns.list(props.kind, { page, rowsPerPage, status: status.value, signal: controller.signal });

async function load() {
  loading.value = true;
  error.value = "";
  try {
    detail.value = await returns.detail(props.kind, props.id, controller.signal);
  } catch (failure) {
    if (!controller.signal.aborted) error.value = failure.message || "未能載入退貨單";
  } finally {
    loading.value = false;
  }
}

onMounted(() => { if (props.id && !creating) void load(); });

async function mutate(action) {
  error.value = "";
  try {
    await command.run({ version: detail.value.version }, body => returns[action](props.kind, props.id, body), action, { action });
    await load();
  } catch (failure) {
    error.value = failure.message || "未能更新退貨單";
  }
}
</script>

<template>
  <PageHeader :title="creating ? `新增${title}` : detail?.returnNumber ?? title">
    <template #actions>
      <q-btn v-if="id" flat label="返回列表" :to="base" />
      <q-btn v-else-if="canWrite" color="primary" :label="`新增${title}`" :to="`${base}/new`" />
    </template>
  </PageHeader>
  <div class="q-px-md q-pb-md">
    <ReturnDraftForm v-if="creating && canWrite" :kind="kind" :base="base" :resource="resource" />
    <q-banner v-else-if="creating" role="alert">你沒有建立此退貨單的權限。</q-banner>
    <template v-else-if="!id">
      <q-select :model-value="status" label="狀態" :options="statuses" class="q-mb-md" style="max-width: 16rem"
        clearable outlined dense emit-value map-options @update:model-value="value => { status = value; tableKey++; }" />
      <DataTable :key="tableKey" :columns="columns" :fetch="fetchRows">
        <template #body-cell-returnNumber="{ row }">
          <q-td><RouterLink :to="`${base}/${row.id}`">{{ row.returnNumber }}</RouterLink></q-td>
        </template>
      </DataTable>
    </template>
    <template v-else>
      <q-banner v-if="error" role="alert" class="q-mb-md text-negative">{{ error }}</q-banner>
      <p v-if="loading" role="status">載入退貨單…</p>
      <template v-else-if="detail">
        <dl class="q-mb-md">
          <dt>狀態</dt><dd>{{ labels[detail.status] }}</dd>
          <dt>{{ resource }}</dt><dd>{{ sourceNumber(detail) }}</dd>
          <dt>{{ customer ? "客戶" : "供應商" }}</dt><dd>{{ detail.partyCode }} — {{ detail.partyName }}</dd>
          <dt>退貨日期</dt><dd>{{ detail.returnDate }}</dd>
          <dt>原因</dt><dd>{{ detail.reason }}</dd>
        </dl>
        <div tabindex="0" role="region" aria-label="退貨明細" class="return-lines">
          <q-markup-table flat bordered>
            <thead>
              <tr>
                <th scope="col">SKU</th><th scope="col">批號</th><th scope="col">倉／庫位</th>
                <th scope="col">狀態</th><th scope="col">基本數量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in detail.lines" :key="line.id">
                <th scope="row">{{ line.skuCode }}</th><td>{{ line.lotNumber || "—" }}</td>
                <td>{{ line.warehouseCode }}／{{ line.binCode }}</td><td>{{ stock[line.stockStatus] }}</td>
                <td class="text-right">{{ line.baseQuantity }}</td>
              </tr>
            </tbody>
          </q-markup-table>
        </div>
        <q-banner v-if="command.isUncertain('cancel') || command.isUncertain('post')" role="status" class="q-mt-md">
          操作結果尚未確認。請重試同一個操作。
        </q-banner>
        <div class="row q-gutter-sm q-mt-md">
          <q-btn v-if="detail.allowedActions.includes('post')" color="primary" label="確認過帳"
            :loading="command.isBusy('post')" :disable="command.isBusy('cancel') || command.isUncertain('cancel')" @click="mutate('post')" />
          <q-btn v-if="detail.allowedActions.includes('cancel')" flat color="negative" label="取消草稿"
            :loading="command.isBusy('cancel')" :disable="command.isBusy('post') || command.isUncertain('post')" @click="mutate('cancel')" />
        </div>
      </template>
      <q-btn v-else-if="error" flat label="重新載入" @click="load" />
    </template>
  </div>
</template>

<style scoped>
.return-lines { overflow: auto; max-inline-size: 100%; }
</style>
