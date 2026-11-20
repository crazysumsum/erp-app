<script>
export const page = { name: "goods-receipt-create", path: "/purchasing/goods-receipts/new", title: "新增收貨單", requires: { permissions: ["purchasing.view", "receiving.operation"] } };
</script>
<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { notifySuccess } from "@/framework/ui/notify.js";
import { useCommandEvent } from "@/composables/purchasing/useCommandEvent.js";
import purchasing from "@/services/purchasing.js";

// 從一張可收貨 PO 建立空白收貨單 Draft，然後去編輯頁加明細（設計 §5.3；TASK-031）。結果不明時用同一 eventId 重試。
const route = useRoute(), router = useRouter(), command = useCommandEvent();
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const form = reactive({ purchaseOrder: null, businessReceiptDate: today(), supplierDeliveryNote: "", notes: "" });
const options = ref([]), lookupError = ref("");
const linkedOrderUnavailable = ref(false);
const required = (value) => Boolean(value) || "必填";

// 可收貨 PO 最多 100 張（20 人規模），載入一次後喺前端同步篩選：冇非同步晚到結果，揀完唔會再打開選單。
const all = ref([]);
onMounted(async () => {
  try {
    all.value = await purchasing.lookupReceivablePurchaseOrders();
    options.value = all.value;
    const linkedId = route.query.purchaseOrderId;
    if (linkedId === undefined) return;

    const id = typeof linkedId === "string" ? Number(linkedId) : NaN;
    let order = all.value.find((row) => row.id === id);
    if (!order && all.value.length === 100 && Number.isSafeInteger(id) && id > 0) {
      const detail = await purchasing.getPurchaseOrder(id).catch((failure) => {
        if (failure.code !== "PURCHASE_ORDER_NOT_FOUND") throw failure;
        return null;
      });
      if (detail?.hasOutstanding) order = detail;
    }
    form.purchaseOrder ??= order ?? null;
    linkedOrderUnavailable.value = !order;
  } catch (failure) {
    lookupError.value = failure.message || "未能載入採購單";
  }
});
function search(q, update) {
  const needle = q.trim().toLowerCase();
  update(() => { options.value = needle ? all.value.filter((row) => `${row.number} ${row.supplierCode} ${row.supplierName}`.toLowerCase().includes(needle)) : all.value; });
}
async function save() {
  const body = { purchaseOrderId: form.purchaseOrder?.id, businessReceiptDate: form.businessReceiptDate,
    ...(form.supplierDeliveryNote ? { supplierDeliveryNote: form.supplierDeliveryNote } : {}), ...(form.notes ? { notes: form.notes } : {}) };
  const created = await command.run(body, purchasing.createGoodsReceipt, "create", { action: "create" });
  notifySuccess(`${created.number} 已建立，請加入收貨明細。`);
  await router.replace(`/purchasing/goods-receipts/${created.id}/edit`);
}
</script>

<template>
  <div>
    <PageHeader subtitle="只列出已確認並仍有未收數量的採購單。" />
    <div class="q-px-md q-pb-md">
      <q-banner v-if="command.isUncertain('create')" role="status" class="bg-warning text-dark q-mb-md">建立結果尚未確認；請按「建立收貨單」重試同一操作以確認結果，不會重複建立。</q-banner>
      <q-banner v-if="linkedOrderUnavailable && !form.purchaseOrder" role="alert" class="bg-warning text-dark q-mb-md">指定的採購單目前無法收貨，請選擇另一張採購單。</q-banner>
      <FormPanel v-slot="{ submitting, fieldError }" :on-submit="save">
        <div class="row q-col-gutter-md">
          <div class="col-12 col-md-6"><q-select v-model="form.purchaseOrder" label="採購單 *" :options="options" :option-label="row => `${row.number}${row.supplierName ? ` — ${row.supplierName}` : ''}`"
            use-input hide-selected fill-input input-debounce="0" :rules="[required]" :error="!!(fieldError('purchaseOrderId') || lookupError)" :error-message="fieldError('purchaseOrderId') || lookupError"
            :disable="command.isUncertain('create')" outlined dense @filter="search"><template #no-option><q-item><q-item-section>沒有可收貨的採購單。</q-item-section></q-item></template></q-select></div>
          <div class="col-12 col-md-3"><q-input v-model="form.businessReceiptDate" label="收貨日期 *" type="date" :rules="[required]" :disable="command.isUncertain('create')" outlined dense
            :error="!!fieldError('businessReceiptDate')" :error-message="fieldError('businessReceiptDate')" /></div>
          <div class="col-12 col-md-3"><q-input v-model="form.supplierDeliveryNote" label="送貨單號（選填）" maxlength="190" :disable="command.isUncertain('create')" outlined dense /></div>
          <div class="col-12"><q-input v-model="form.notes" label="備註（選填）" type="textarea" autogrow maxlength="2000" :disable="command.isUncertain('create')" outlined dense /></div>
        </div>
        <div class="row q-gutter-sm q-mt-md">
          <q-btn type="submit" color="primary" label="建立收貨單" :loading="submitting || command.isBusy('create')" />
          <q-btn flat label="返回列表" to="/purchasing/goods-receipts" />
        </div>
      </FormPanel>
    </div>
  </div>
</template>
