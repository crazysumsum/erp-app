<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import purchasing from "@/services/purchasing.js";
import { statusLabels, timestamp } from "./purchaseOrderPresentation.js";
import { receiptStatusColors, receiptStatusLabels } from "./goodsReceiptPresentation.js";

// 採購單詳情嘅收貨單同狀態歷史（TASK-026 首期最小部分）：列出呢張 PO 嘅收貨單（最多 100 張），可收貨時提供建立入口。
const props = defineProps({ purchaseOrder: { type: Object, required: true } });
const session = useSessionStore();
const receipts = ref([]), error = ref("");
const receivable = computed(() => ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(props.purchaseOrder.status)
  && props.purchaseOrder.lines.some((line) => line.outstandingBaseQuantity !== "0")
  && can(session, { permissions: ["purchasing.view", "receiving.operation"] }));
const ACTIONS = { CREATE: "建立", SUBMIT: "提交審批", APPROVE: "批准", REJECT: "拒絕", WITHDRAW: "撤回", CONFIRM: "確認", RECEIVE: "收貨", CLOSE: "結案", CANCEL: "取消", REVERSE: "沖銷" };
let controller = null;
async function load() {
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  error.value = "";
  try {
    receipts.value = (await purchasing.listGoodsReceipts({ purchaseOrderId: props.purchaseOrder.id, rowsPerPage: 100, signal })).rows;
  } catch (failure) { if (!signal.aborted) error.value = failure.message || "未能載入收貨單"; }
}
watch(() => [props.purchaseOrder.id, props.purchaseOrder.version], load, { immediate: true });
onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <q-card flat bordered class="q-mt-md" data-testid="po-receipts">
    <q-card-section>
      <div class="row items-center justify-between q-mb-sm">
        <h2 class="text-h6 q-ma-none">收貨單</h2>
        <q-btn v-if="receivable" color="primary" outline dense label="建立收貨單" :to="`/purchasing/goods-receipts/new?purchaseOrderId=${purchaseOrder.id}`" />
      </div>
      <q-banner v-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <p v-else-if="!receipts.length" class="q-mb-none">尚未有收貨單。</p>
      <q-list v-else dense separator>
        <q-item v-for="row in receipts" :key="row.id" clickable :to="`/purchasing/goods-receipts/${row.id}`">
          <q-item-section>{{ row.number }}・{{ row.businessReceiptDate }}・{{ row.totalReceivedBaseQuantity }}</q-item-section>
          <q-item-section side><q-badge :color="receiptStatusColors[row.status]" :label="receiptStatusLabels[row.status]" /></q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
    <q-card-section v-if="purchaseOrder.statusHistory?.length" class="q-pt-none">
      <h2 class="text-h6 q-ma-none q-mb-sm">狀態歷史</h2>
      <q-list dense separator>
        <q-item v-for="entry in purchaseOrder.statusHistory" :key="entry.sequenceNo">
          <q-item-section>{{ ACTIONS[entry.action] ?? entry.action }}：{{ statusLabels[entry.fromStatus] ?? "—" }} → {{ statusLabels[entry.toStatus] ?? entry.toStatus }}<template v-if="entry.reason">（{{ entry.reason }}）</template></q-item-section>
          <q-item-section side>{{ entry.actorLabel }}・{{ timestamp(entry.occurredAt) }}</q-item-section>
        </q-item>
      </q-list>
    </q-card-section>
  </q-card>
</template>
