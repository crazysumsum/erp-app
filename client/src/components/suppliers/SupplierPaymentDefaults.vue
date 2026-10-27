<script setup>
import { computed, onMounted, ref } from "vue";
import supplierService from "@/services/supplier.js";
import { notifyError } from "@/framework/ui/notify.js";

const model = defineModel({ required: true });
const props = defineProps({
  fieldError: { type: Function, default: () => "" },
  // 而家儲存咗嘅付款條件（詳情回應嘅 defaultPaymentTerm）。停用咗就唔喺 Active 選項入面，照樣要顯示佢嘅名稱（DEF-038）。
  currentPaymentTerm: { type: Object, default: null }
});
const currencyOptions = ref([]);
const activePaymentTerms = ref([]);
// 唔喺 Active 清單入面（載入緊、載入失敗、或者唔喺頭 100 個）都照樣顯示名稱；停用與否睇伺服器嘅 status，唔係睇喺唔喺清單（REV-116 M-1）。
const paymentTermOptions = computed(() => {
  const current = props.currentPaymentTerm;
  if (!current || activePaymentTerms.value.some((item) => item.value === current.id)) return activePaymentTerms.value;
  const inactive = current.status === "INACTIVE";
  return [...activePaymentTerms.value, { label: `${current.code} — ${current.name}${inactive ? "（已停用）" : ""}`, value: current.id, disable: inactive }];
});
const loading = ref(false);

async function loadOptions() {
  loading.value = true;
  try {
    const [currencies, paymentTerms] = await Promise.all([
      supplierService.currencyOptions(),
      supplierService.paymentTermOptions()
    ]);
    currencyOptions.value = currencies.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.code, version: item.version }));
    activePaymentTerms.value = paymentTerms.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.id, version: item.version }));
  } catch (error) {
    notifyError(error.message || "載入貨幣／付款條件失敗");
  } finally {
    loading.value = false;
  }
}

function selectCurrency(code) {
  model.value.defaultCurrencyVersion = currencyOptions.value.find((item) => item.value === code)?.version;
}

function selectPaymentTerm(id) {
  model.value.defaultPaymentTermVersion = activePaymentTerms.value.find((item) => item.value === id)?.version;
}

onMounted(loadOptions);
</script>

<template>
  <div class="row q-col-gutter-md">
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.defaultCurrencyCode"
        :options="currencyOptions"
        emit-value map-options outlined dense :loading="loading"
        label="Default Currency *" aria-label="Default Currency *"
        :error="!!props.fieldError('defaultCurrencyCode')"
        :error-message="props.fieldError('defaultCurrencyCode')"
        @update:model-value="selectCurrency"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.defaultPaymentTermId"
        :options="paymentTermOptions"
        emit-value map-options clearable outlined dense :loading="loading"
        label="預設付款條件（選填）" aria-label="預設付款條件（選填）"
        :error="!!props.fieldError('defaultPaymentTermId')"
        :error-message="props.fieldError('defaultPaymentTermId')"
        @update:model-value="selectPaymentTerm"
      />
    </div>
  </div>
</template>
