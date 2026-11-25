<script setup>
import { nextTick, reactive, ref, useId } from "vue";
import { amountInputValid, today } from "./apPresentation.js";

const props = defineProps({ invoice: { type: Object, required: true }, credit: { type: Object, default: null },
  initialDraft: { type: Object, default: null }, locked: Boolean });
const emit = defineEmits(["save", "cancel"]);
const blankLine = () => ({ key: crypto.randomUUID(), invoiceLineId: null, supplierReturnLineId: "", baseQuantity: "", amount: "", description: "" });
const draft = props.initialDraft ?? props.credit;
const form = reactive({
  creditDate: draft?.creditDate ?? today(), reason: draft?.reason ?? "", notes: draft?.notes ?? "",
  supplierCreditReference: draft?.supplierCreditReference ?? "", supplierReturnId: draft?.supplierReturnId ?? ""
});
const lines = ref(draft ? draft.lines.map((line) => ({
  ...blankLine(), invoiceLineId: line.invoiceLineId, amount: line.amount, description: line.description,
  supplierReturnLineId: line.supplierReturnLineId ?? "", baseQuantity: line.baseQuantity ?? ""
})) : [blankLine()]);
const error = ref(""), alert = ref(null), heading = useId();
const sourceLabel = (line) => `${line.lineNo}. ${line.lineType === "RECEIPT" ? line.skuName || line.skuCode : line.description}`;
const validId = (value) => value === "" || /^[1-9]\d{0,19}$/u.test(value);
const amountHint = `大於零，最多 ${props.invoice.currencyDecimalPlaces} 位小數`;
async function save() {
  error.value = "";
  if (!form.reason.trim()) error.value = "請填寫貸項原因。";
  else if (!validId(form.supplierReturnId) || lines.value.some((line) => !validId(line.baseQuantity) ||
    (form.supplierReturnId && !validId(line.supplierReturnLineId)))) error.value = "退貨 ID 與基本數量須為正整數。";
  else if (lines.value.some((line) => !line.invoiceLineId || !amountInputValid(line.amount, props.invoice.currencyDecimalPlaces))) {
    error.value = `請選擇每行的原發票行並輸入有效金額（${amountHint}）。`;
  }
  if (error.value) {
    await nextTick();
    alert.value?.focus();
    return;
  }
  emit("save", {
    ...form, reason: form.reason.trim(), supplierReturnId: form.supplierReturnId || null,
    lines: lines.value.map(({ invoiceLineId, amount, description, baseQuantity, supplierReturnLineId }) => ({
      invoiceLineId, amount, description, baseQuantity: baseQuantity || null,
      supplierReturnLineId: form.supplierReturnId && supplierReturnLineId ? supplierReturnLineId : null
    }))
  });
}
</script>

<template>
  <form action="/api/v1/ap-credit-notes" method="post" :aria-labelledby="heading" @submit.prevent="save">
    <h2 :id="heading" class="text-h6">{{ credit ? "編輯貸項草稿" : "貸項草稿" }}</h2>
    <p v-if="error" ref="alert" tabindex="-1" role="alert" class="text-negative">{{ error }}</p>
    <fieldset :disabled="locked" class="draft-fields">
      <legend class="text-subtitle1">貸項資料</legend>
      <div class="row q-col-gutter-md q-mb-md">
        <q-input v-model="form.creditDate" name="creditDate" type="date" label="貸項日期" stack-label required outlined class="col-12 col-sm-4" />
        <q-input v-model="form.supplierCreditReference" name="supplierCreditReference" label="供應商貸項單號（選填）" maxlength="100" outlined class="col-12 col-sm-4" />
        <q-input v-if="invoice.lines.some((line) => line.lineType === 'RECEIPT')" v-model.trim="form.supplierReturnId" name="supplierReturnId"
          label="退回供應商單 ID（選填）" inputmode="numeric" maxlength="20" outlined class="col-12 col-sm-4" />
        <q-input v-model="form.reason" name="reason" label="貸項原因" required maxlength="500" outlined class="col-12" />
        <q-input v-model="form.notes" name="notes" label="備註（選填）" type="textarea" rows="2" maxlength="2000" outlined class="col-12" />
      </div>
      <fieldset v-for="(line, index) in lines" :key="line.key" class="line-fields q-mb-md">
        <legend class="text-subtitle2">貸項行 {{ index + 1 }}</legend>
        <div class="row q-col-gutter-md items-end">
          <div class="col-12 col-sm-6 q-pb-md">
            <label :for="`${heading}-${line.key}`">原發票行</label>
            <select :id="`${heading}-${line.key}`" v-model="line.invoiceLineId" :name="`line-${index}-invoice`" required class="invoice-line-select">
              <option :value="null" disabled>選擇原發票行</option>
              <option v-for="source in invoice.lines" :key="source.id" :value="source.id">{{ sourceLabel(source) }}</option>
            </select>
          </div>
          <q-input v-model.trim="line.amount" :name="`line-${index}-amount`" label="貸項金額" :prefix="invoice.currencyCode" :hint="amountHint"
            inputmode="decimal" maxlength="20" required outlined class="col-12 col-sm-6" />
          <q-input v-model.trim="line.baseQuantity" :name="`line-${index}-quantity`" label="基本數量（選填）"
            inputmode="numeric" maxlength="20" outlined class="col-12 col-sm-6" />
          <q-input v-if="form.supplierReturnId" v-model.trim="line.supplierReturnLineId" :name="`line-${index}-return`" label="退貨行 ID（選填）"
            inputmode="numeric" maxlength="20" outlined class="col-12 col-sm-6" />
          <q-input v-model="line.description" :name="`line-${index}-description`" label="行說明（選填）" maxlength="500" outlined class="col-12 col-sm-9" />
          <div v-if="lines.length > 1" class="col-12 col-sm-3">
            <q-btn flat type="button" color="negative" :label="`移除第 ${index + 1} 行`" @click="lines.splice(index, 1)" />
          </div>
        </div>
      </fieldset>
      <div class="row q-gutter-sm">
        <q-btn flat type="button" label="新增貸項行" @click="lines.push(blankLine())" />
        <q-btn color="primary" type="submit" :label="credit ? '儲存草稿' : '建立貸項草稿'" />
        <q-btn v-if="credit" flat type="button" label="返回詳情" @click="emit('cancel')" />
      </div>
    </fieldset>
  </form>
</template>

<style scoped>
.draft-fields { border: 0; padding-inline: 0; }
.draft-fields, .line-fields { min-inline-size: 0; }
.line-fields { border: 1px solid var(--q-color-grey-5, #757575); border-radius: 4px; }
.invoice-line-select { display: block; inline-size: 100%; min-block-size: 3rem; font: inherit; color: inherit; }
</style>
