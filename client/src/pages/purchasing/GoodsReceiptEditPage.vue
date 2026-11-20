<script>
export const page = { name: "goods-receipt-edit", path: "/purchasing/goods-receipts/:id/edit", title: "編輯收貨單", requires: { permissions: ["purchasing.view", "receiving.operation"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import GoodsReceiptForm from "@/components/purchasing/GoodsReceiptForm.vue";
import purchasing from "@/services/purchasing.js";

/**
 * 收貨單 Draft 編輯及確認（TASK-031；確認流程見 TASK-034）。頁面係 command owner：儲存／確認結果不明時保留原 eventId，
 * 用同一操作重試會由伺服器 replay 原結果（設計 §2.7），唔會重複入庫；唔好換 eventId 重送。
 */
const route = useRoute(), router = useRouter();
const save = useCommandEvent(), confirm = useCommandEvent();
const receipt = ref(null), purchaseOrder = ref(null), loading = ref(true), loadError = ref("");
const id = computed(() => Number(route.params.id));
const key = (action) => `${id.value}:${action}`;
const uncertain = computed(() => save.isUncertain(key("save")) || confirm.isUncertain(key("confirm")));
let controller = null;

async function load() {
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  loading.value = true; loadError.value = "";
  try {
    const gr = await purchasing.getGoodsReceipt(id.value, { signal });
    if (gr.status !== "DRAFT") { await router.replace(`/purchasing/goods-receipts/${gr.id}`); return; }
    purchaseOrder.value = await purchasing.getPurchaseOrder(gr.purchaseOrderId, { signal });
    receipt.value = gr;
  } catch (failure) {
    if (!signal.aborted) loadError.value = failure.message || "未能載入收貨單";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch(id, load, { immediate: true });
onBeforeUnmount(() => controller?.abort());

async function onSave(body) {
  const result = await save.run(body, (payload) => purchasing.updateGoodsReceipt(id.value, payload), key("save"), { action: "save" });
  notifySuccess(`${result.number} 草稿已儲存。`);
  await load();
  return result;
}
async function onConfirm(body) {
  const result = await confirm.run(body, (payload) => purchasing.confirmGoodsReceipt(id.value, payload), key("confirm"), { action: "confirm" });
  notifySuccess(`${result.number} 已確認收貨並入庫。`);
  await router.replace(`/purchasing/goods-receipts/${id.value}`);
  return result;
}
</script>

<template>
  <div>
    <PageHeader :title="receipt?.number ?? '編輯收貨單'" :subtitle="purchaseOrder ? `採購單 ${purchaseOrder.number} — ${purchaseOrder.supplierName}` : ''" />
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading" type="rect" aria-label="載入收貨單" />
      <q-banner v-else-if="loadError" role="alert" class="bg-negative text-white">{{ loadError }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="receipt && purchaseOrder">
        <q-banner v-if="uncertain" role="status" class="bg-warning text-dark q-mb-md">
          {{ confirm.isUncertain(key('confirm')) ? "確認" : "儲存" }}結果尚未確認；請再按同一個按鈕，以原內容重試確認結果，不會重複入庫。
        </q-banner>
        <GoodsReceiptForm :document="receipt" :purchase-order="purchaseOrder" :on-save="onSave" :on-confirm="onConfirm" />
      </template>
    </div>
  </div>
</template>
