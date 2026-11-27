<script>
export const page = { name: "goods-receipt-detail", path: "/purchasing/goods-receipts/:id", title: "收貨單詳情", requires: { permissions: ["purchasing.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { promptReason } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import purchasing from "@/services/purchasing.js";
import { receiptStatusColors, receiptStatusLabels } from "@/components/purchasing/goodsReceiptPresentation.js";
import GoodsReceiptReversalDialog from "@/components/purchasing/GoodsReceiptReversalDialog.vue";

const route = useRoute(), cancelCommand = useCommandEvent();
const receipt = ref(null), loading = ref(true), loadError = ref("");
const id = computed(() => Number(route.params.id));
const STATUS = { AVAILABLE: "可用", QUARANTINED: "隔離", DAMAGED: "損壞" };
let controller = null;

async function load() {
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal;
  loading.value = true; loadError.value = "";
  try { receipt.value = await purchasing.getGoodsReceipt(id.value, { signal }); } catch (failure) { if (!signal.aborted) loadError.value = failure.message || "未能載入收貨單"; }
  finally { if (!signal.aborted) loading.value = false; }
}
watch(id, load, { immediate: true });
onBeforeUnmount(() => controller?.abort());

async function cancelDraft() {
  const reason = await promptReason({ title: "取消收貨單", message: `取消 ${receipt.value.number}？編號會保留，取消後不能再編輯。請填寫原因（5–190 字）。`, okLabel: "取消收貨單" });
  if (!reason) return;
  try {
    await cancelCommand.run({ version: receipt.value.version, reason }, (body) => purchasing.cancelGoodsReceipt(id.value, body), `${id.value}:cancel`, { action: "cancel" });
    notifySuccess(`${receipt.value.number} 已取消。`);
    await load();
  } catch (failure) {
    notifyError(cancelCommand.isUncertain(`${id.value}:cancel`) ? "取消結果尚未確認；請再按一次「取消收貨單」以原內容重試。" : failure.message || "取消失敗");
  }
}

async function reversalPosted(result) {
  notifySuccess(`沖銷單 ${result.number} 已過帳。`);
  await load();
}
</script>

<template>
  <div>
    <PageHeader :title="receipt?.number ?? '收貨單詳情'" :subtitle="receipt ? `採購單 ${receipt.purchaseOrderNumber} — ${receipt.supplierCode} ${receipt.supplierName}` : ''">
      <template #actions>
        <q-btn v-if="receipt?.allowedActions.includes('update')" color="primary" label="編輯／確認" :to="`/purchasing/goods-receipts/${id}/edit`" />
        <q-btn v-if="receipt?.allowedActions.includes('cancel')" flat color="negative" label="取消收貨單" :loading="cancelCommand.isBusy(`${id}:cancel`)" @click="cancelDraft" />
        <GoodsReceiptReversalDialog v-if="receipt && receipt.id === id" :key="id" :receipt="receipt" @posted="reversalPosted" />
        <q-btn flat label="返回列表" to="/purchasing/goods-receipts" />
      </template>
    </PageHeader>
    <div class="q-px-md q-pb-md">
      <q-skeleton v-if="loading" type="rect" aria-label="載入收貨單" />
      <q-banner v-else-if="loadError" role="alert" class="bg-negative text-white">{{ loadError }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
      <template v-else-if="receipt">
        <q-card flat bordered class="q-mb-md">
          <q-card-section>
            <div class="row q-col-gutter-md items-center">
              <div class="col-auto"><q-badge :color="receiptStatusColors[receipt.status]" :label="receiptStatusLabels[receipt.status]" /></div>
              <div class="col-12 col-sm-auto">收貨日期：{{ receipt.businessReceiptDate }}</div>
              <div class="col-12 col-sm-auto">送貨單號：{{ receipt.supplierDeliveryNote || "未填" }}</div>
              <div class="col-12 col-sm-auto">收貨數量（基本單位）：{{ receipt.totalReceivedBaseQuantity }}</div>
              <div v-if="receipt.totalReversedBaseQuantity !== '0'" class="col-12 col-sm-auto">已沖銷（基本單位）：{{ receipt.totalReversedBaseQuantity }}</div>
            </div>
            <div class="row q-gutter-sm q-mt-sm" aria-label="風險標記">
              <q-chip v-if="receipt.hasOverReceipt" icon="warning" color="warning" text-color="dark" label="超收" />
              <q-chip v-if="receipt.hasExpiryOverride" icon="event_busy" color="warning" text-color="dark" label="低效期放行" />
              <q-chip v-if="receipt.hasSkuException" icon="report" color="warning" text-color="dark" label="貨品例外" />
              <q-chip v-if="receipt.supplierExceptionReason" icon="store" color="warning" text-color="dark" :label="`供應商例外：${receipt.supplierExceptionReason}`" />
            </div>
            <p v-if="receipt.notes" class="q-mt-sm q-mb-none break-word">備註：{{ receipt.notes }}</p>
            <p v-if="receipt.status === 'CANCELLED'" class="q-mt-sm q-mb-none break-word">取消原因：{{ receipt.cancelReason }}</p>
          </q-card-section>
        </q-card>
        <p v-if="!receipt.lines.length" class="text-body2">尚未有收貨明細。</p>
        <section v-for="line in receipt.lines" :key="line.id" class="q-mb-md" :aria-labelledby="`gr-line-${line.id}`">
          <q-card flat bordered>
            <q-card-section>
              <h2 :id="`gr-line-${line.id}`" class="text-subtitle1 q-ma-none">第 {{ line.lineNumber }} 行：{{ line.skuCode }} — {{ line.skuName }}（{{ line.receivedBaseQuantity }}）</h2>
              <div v-if="line.overReceivedBaseQuantity !== '0'" class="text-caption"><q-icon name="warning" aria-hidden="true" /> 超收 {{ line.overReceivedBaseQuantity }}：{{ line.overReceiptReason }}</div>
              <div v-if="line.skuExceptionReason" class="text-caption"><q-icon name="report" aria-hidden="true" /> 貨品例外：{{ line.skuExceptionReason }}</div>
              <q-list dense separator class="q-mt-sm">
                <q-item v-for="detail in line.details" :key="detail.id">
                  <q-item-section>
                    <q-item-label>{{ detail.receivedQuantity }} {{ detail.inputUomCode }}（基本 {{ detail.receivedBaseQuantity }}）→ {{ detail.warehouseCode }} / {{ detail.binCode }}・{{ STATUS[detail.stockStatus] ?? detail.stockStatus }}</q-item-label>
                    <q-item-label v-if="detail.lotNumber" caption>批號 {{ detail.lotNumber }}<template v-if="detail.expiryDate">・到期 {{ detail.expiryDate }}</template><template v-if="detail.expiryOverrideReason">・放行原因：{{ detail.expiryOverrideReason }}</template></q-item-label>
                    <q-item-label v-if="detail.inventoryMovementId" caption>庫存異動 #{{ detail.inventoryMovementId }}</q-item-label>
                    <q-item-label v-if="detail.reversedBaseQuantity !== '0'" caption>已沖銷基本數量 {{ detail.reversedBaseQuantity }}</q-item-label>
                  </q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </section>
        <q-card v-if="receipt.reversals.length" flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1 q-ma-none">沖銷紀錄</h2>
            <q-list dense separator>
              <q-item v-for="reversal in receipt.reversals" :key="reversal.id">
                <q-item-section>
                  <q-item-label>{{ reversal.number }} · 基本數量 {{ reversal.totalReversedBaseQuantity }}</q-item-label>
                  <q-item-label caption>{{ new Date(reversal.confirmedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) }} · {{ reversal.reason }}</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card-section>
        </q-card>
      </template>
    </div>
  </div>
</template>
