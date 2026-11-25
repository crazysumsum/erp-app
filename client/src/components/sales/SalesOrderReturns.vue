<script setup>
import { onBeforeUnmount, ref } from "vue";
import appConfig from "@config/app.js";
import { httpClient } from "@/framework/http/HttpClient.js";

const props = defineProps({ orderId: { type: [Number, String], required: true } });
const pageSize = appConfig.defaultPageSize;
const statusLabels = new Map([["DRAFT", "草稿"], ["POSTED", "已過帳"], ["CANCELLED", "已取消"]]);
const validId = /^[1-9][0-9]*$/u;
const page = ref(1);
const result = ref(null);
const loading = ref(false);
const error = ref("");
let request;

async function load(nextPage) {
  if (loading.value) return;
  page.value = nextPage;
  loading.value = true;
  error.value = "";
  request = new AbortController();
  const { signal } = request;

  try {
    const data = await httpClient.get("/api/v1/customer-returns", {
      params: { salesOrderId: props.orderId, page: nextPage, pageSize },
      signal
    });
    if (signal.aborted) return;
    if (!Array.isArray(data?.items) || !Number.isSafeInteger(data.total) || data.total < data.items.length ||
      data.items.some(row => typeof row?.id !== "string" || !validId.test(row.id) ||
        typeof row.returnNumber !== "string" || typeof row.shipmentNumber !== "string" || !statusLabels.has(row.status))) {
      throw new Error("Invalid customer returns response");
    }
    result.value = data;
  } catch (cause) {
    if (signal.aborted) return;
    result.value = null;
    error.value = cause?.status === 403 ? "沒有權限查看客戶退貨。" : "暫時無法載入客戶退貨。";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

function onToggle(event) {
  if (event.currentTarget.open && !result.value && !error.value) load(1);
}

onBeforeUnmount(() => request?.abort());
</script>

<template>
  <section class="q-my-md" aria-labelledby="sales-returns-title">
    <h2 id="sales-returns-title" class="text-h6 q-ma-none q-mb-sm">客戶退貨</h2>
    <details @toggle="onToggle">
      <summary class="cursor-pointer q-py-sm">查看客戶退貨</summary>
      <p v-if="loading" role="status">正在載入客戶退貨…</p>
      <template v-else-if="error">
        <p role="alert" class="text-negative q-mb-sm">{{ error }}</p>
        <q-btn flat label="重試載入客戶退貨" @click="load(page)" />
      </template>
      <p v-else-if="result?.total === 0" role="status">此訂單沒有客戶退貨。</p>
      <ul v-else-if="result" class="q-my-sm">
        <li v-for="row in result.items" :key="row.id" class="return-row q-mb-sm">
          <RouterLink :to="`/customer-returns/${row.id}`">{{ row.returnNumber }}</RouterLink>
          <span> · {{ statusLabels.get(row.status) }} · 出貨單 {{ row.shipmentNumber }}</span>
        </li>
      </ul>
      <nav v-if="result && (page > 1 || result.total > pageSize)" aria-label="客戶退貨分頁" class="row items-center q-gutter-sm">
        <q-btn flat label="上一頁" :disable="loading || page === 1" @click="load(page - 1)" />
        <span role="status">第 {{ page }} 頁</span>
        <q-btn flat label="下一頁" :disable="loading || page * pageSize >= result.total" @click="load(page + 1)" />
      </nav>
    </details>
  </section>
</template>

<style scoped>
.return-row { overflow-wrap: anywhere; }
</style>
