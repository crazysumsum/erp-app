<script setup>
import { onMounted, ref } from "vue";
import businessMasterService from "@/services/businessMaster.js";
import { notifyError } from "@/framework/ui/notify.js";

const model = defineModel({ required: true });
const props = defineProps({ fieldError: { type: Function, default: () => "" } });
const currencyOptions = ref([]);
const paymentTermOptions = ref([]);
const loading = ref(false);

async function loadOptions() {
  loading.value = true;
  try {
    const [currencies, paymentTerms] = await Promise.all([
      businessMasterService.currencyList({ page: 1, rowsPerPage: 100, status: "ACTIVE", sortBy: "code" }),
      businessMasterService.paymentTermList({ page: 1, rowsPerPage: 100, status: "ACTIVE", sortBy: "code" })
    ]);
    currencyOptions.value = currencies.rows.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.code, version: item.version }));
    paymentTermOptions.value = paymentTerms.rows.map((item) => ({ label: `${item.code} — ${item.name}`, value: item.id, version: item.version }));
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
  model.value.defaultPaymentTermVersion = paymentTermOptions.value.find((item) => item.value === id)?.version;
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
        @update:model-value="selectPaymentTerm"
      />
    </div>
  </div>
</template>
