<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import FormPanel from "@/framework/ui/FormPanel.vue";
import { confirm } from "@/framework/ui/confirm.js";
import purchasing from "@/services/purchasing.js";
import ReceiptLineEditor from "./ReceiptLineEditor.vue";
import { newLine, toForm, toPayload, withFieldDetails } from "./receiptForm.js";

/**
 * 收貨單 Draft 編輯及確認（設計 §7.5～7.7；TASK-030）。只負責編輯同組 body：儲存同確認由頁面（command owner）用
 * `onSave`／`onConfirm` 送出，兩者都係完整 replace（§5.3），所以畫面上嘅內容就係會確認嘅內容。
 */
const props = defineProps({
  document: { type: Object, required: true }, purchaseOrder: { type: Object, required: true },
  onSave: { type: Function, required: true }, onConfirm: { type: Function, required: true }, locked: { type: Boolean, default: false }
});
const form = reactive({ businessReceiptDate: "", supplierDeliveryNote: "", notes: "", supplierExceptionReason: "", lines: [] });
const warehouses = ref([]), optionsError = ref(""), adding = ref(null);
const intent = ref("save");
const FIELD_LABELS = {
  businessReceiptDate: "收貨日期", supplierDeliveryNote: "供應商送貨單號", notes: "備註",
  supplierExceptionReason: "供應商例外原因", lines: "收貨明細", purchaseOrderLineId: "採購單行",
  overReceiptReason: "超收原因", skuExceptionReason: "貨品例外原因", details: "收貨明細",
  inputUomId: "單位", receivedQuantity: "數量", warehouseId: "倉庫", binId: "庫位", lotNumber: "批號",
  expiryDate: "到期日", manufactureDate: "生產日", stockStatus: "庫存狀態", expiryOverrideReason: "低效期放行原因"
};
let submittedLines = [];

watch(() => props.document, (document) => Object.assign(form, toForm(document)), { immediate: true });
onMounted(async () => {
  try { warehouses.value = await purchasing.lookupReceivingWarehouses(); } catch (failure) { optionsError.value = failure.message || "未能載入倉庫"; }
});

const poLines = computed(() => new Map(props.purchaseOrder.lines.map((line) => [line.id, line])));
// 只可以加入仲有未收數量而且未關閉嘅 PO line；已經喺表單嘅唔再出現。
const addable = computed(() => props.purchaseOrder.lines.filter((line) => line.closedRemainingBaseQuantity === "0" && line.outstandingBaseQuantity !== "0"
  && !form.lines.some((current) => current.purchaseOrderLineId === line.id)));
const defaultWarehouse = computed(() => props.purchaseOrder.defaultReceivingWarehouseId ?? null);

function addLine(line) {
  if (!line) return;
  form.lines.push(newLine(line, defaultWarehouse.value));
  adding.value = null;
}
function formatFieldError(path, message) {
  const match = /^lines\.(\d+)(?:\.details\.(\d+))?(?:\.(\w+))?$/u.exec(path);
  const field = match ? match[3] : path;
  const label = Object.hasOwn(FIELD_LABELS, field) ? FIELD_LABELS[field] : "";
  if (!match) return label ? `${label}：${message}` : message;

  const line = submittedLines[Number(match[1])];
  if (!line) return message;
  const detailIndex = match[2];
  const showDetail = detailIndex !== undefined && line.detailCount > 1 && Number(detailIndex) < line.detailCount;
  const detail = showDetail ? `第 ${Number(detailIndex) + 1} 筆明細` : "";
  const position = [`第 ${line.number} 行`, detail, label].filter(Boolean).join(" ");
  return `${position}：${message}`;
}
async function submit() {
  const body = toPayload(form, props.document.version);
  // 確認會即時入庫；事後更正須另外過帳沖銷單（TL 8a852727）。
  if (intent.value === "confirm" && !(await confirm({ title: "確認收貨並入庫", okLabel: "確認入庫",
    message: "確認後會即時增加庫存並更新採購單收貨進度。日後如需更正，請另開沖銷單。要繼續嗎？" }))) return null;
  // 錯誤路徑指向已提交的資料，移除或修改表單行後仍須顯示原來的行號。
  submittedLines = body.lines.map((line, index) => ({
    number: poLines.value.get(line.purchaseOrderLineId)?.lineNumber ?? index + 1, detailCount: line.details.length
  }));
  try {
    return await (intent.value === "confirm" ? props.onConfirm(body) : props.onSave(body));
  } catch (error) {
    throw withFieldDetails(error);
  }
}
</script>

<template>
  <FormPanel v-slot="{ submitting, fieldError }" :on-submit="submit" :format-field-error="formatFieldError">
    <fieldset class="q-pa-none q-ma-none" :disabled="submitting || locked" :inert="submitting || locked">
      <section aria-labelledby="gr-header-heading">
        <h2 id="gr-header-heading" class="text-h6 q-mt-none q-mb-md">收貨資料</h2>
        <q-banner v-if="optionsError" role="alert" class="bg-warning text-dark q-mb-md">{{ optionsError }}</q-banner>
        <div class="row q-col-gutter-md">
          <div class="col-12 col-sm-4"><q-input v-model="form.businessReceiptDate" label="收貨日期 *" type="date" outlined dense
            :error="!!fieldError('businessReceiptDate')" :error-message="fieldError('businessReceiptDate')" /></div>
          <div class="col-12 col-sm-8"><q-input v-model="form.supplierDeliveryNote" label="供應商送貨單號（選填）" maxlength="190" outlined dense
            :error="!!fieldError('supplierDeliveryNote')" :error-message="fieldError('supplierDeliveryNote')" /></div>
          <div class="col-12"><q-input v-model="form.notes" label="備註（選填）" type="textarea" autogrow maxlength="2000" outlined dense
            :error="!!fieldError('notes')" :error-message="fieldError('notes')" /></div>
          <div class="col-12"><q-input v-model="form.supplierExceptionReason" label="供應商例外原因（供應商停用、封存或封鎖時必填；封鎖時所有明細須設為隔離）" maxlength="500" outlined dense
            :error="!!fieldError('supplierExceptionReason')" :error-message="fieldError('supplierExceptionReason')" /></div>
        </div>
      </section>

      <section aria-labelledby="gr-lines-heading" class="q-mt-lg">
        <h2 id="gr-lines-heading" class="text-h6 q-mt-none q-mb-md">收貨明細</h2>
        <q-banner v-if="fieldError('lines')" role="alert" class="bg-negative text-white q-mb-md">{{ fieldError('lines') }}</q-banner>
        <p v-if="!form.lines.length" class="text-body2">尚未加入任何採購單行；請從下方選擇。</p>
        <template v-for="(line, index) in form.lines" :key="line.purchaseOrderLineId">
          <ReceiptLineEditor v-if="poLines.get(line.purchaseOrderLineId)" v-model="form.lines[index]" :po-line="poLines.get(line.purchaseOrderLineId)"
            :warehouses="warehouses" :index="index" :field-error="fieldError" @remove="form.lines.splice(index, 1)" />
        </template>
        <q-select v-model="adding" label="加入採購單行" :options="addable" :option-label="row => `第 ${row.lineNumber} 行：${row.skuCode} — ${row.skuName}（未收 ${row.outstandingBaseQuantity} ${row.baseUomCode}）`"
          outlined dense clearable :disable="!addable.length" class="q-mt-sm" @update:model-value="addLine" />
      </section>

      <div class="row q-gutter-sm q-mt-lg">
        <q-btn type="submit" color="primary" outline label="儲存草稿" :loading="submitting" @click="intent = 'save'" />
        <q-btn type="submit" color="primary" label="確認收貨並入庫" :loading="submitting" :disable="!form.lines.length" @click="intent = 'confirm'" />
      </div>
    </fieldset>
  </FormPanel>
</template>
