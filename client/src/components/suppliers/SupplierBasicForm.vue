<script setup>
import { onMounted, ref } from "vue";
import businessMasterService from "@/services/businessMaster.js";
import { notifyError } from "@/framework/ui/notify.js";

const model = defineModel({ required: true });
const props = defineProps({
  fieldError: { type: Function, default: () => "" }
});

const currencyOptions = ref([]);
const paymentTermOptions = ref([]);
const loadingOptions = ref(false);

function selectCurrency(code) {
  const selected = currencyOptions.value.find((option) => option.value === code);
  model.value.defaultCurrencyVersion = selected?.version;
}

async function loadOptions() {
  loadingOptions.value = true;
  try {
    const [currencies, paymentTerms] = await Promise.all([
      businessMasterService.currencyList({ page: 1, rowsPerPage: 100, status: "ACTIVE", sortBy: "code" }),
      businessMasterService.paymentTermList({ page: 1, rowsPerPage: 100, status: "ACTIVE", sortBy: "code" })
    ]);
    currencyOptions.value = currencies.rows.map((currency) => ({
      label: `${currency.code} — ${currency.name}`,
      value: currency.code,
      version: currency.version
    }));
    paymentTermOptions.value = paymentTerms.rows.map((term) => ({
      label: `${term.code} — ${term.name}`,
      value: term.id,
      version: term.version
    }));
  } catch (error) {
    notifyError(error.message || "載入貨幣／付款條件失敗");
  } finally {
    loadingOptions.value = false;
  }
}

function selectPaymentTerm(id) {
  const selected = paymentTermOptions.value.find((option) => option.value === id);
  model.value.defaultPaymentTermVersion = selected?.version;
}

onMounted(loadOptions);
</script>

<template>
  <div class="row q-col-gutter-md">
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.supplierCode"
        label="Supplier Code *"
        outlined
        dense
        maxlength="64"
        :error="!!props.fieldError('supplierCode')"
        :error-message="props.fieldError('supplierCode')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.supplierName"
        label="Supplier Name *"
        outlined
        dense
        maxlength="190"
        :error="!!props.fieldError('supplierName')"
        :error-message="props.fieldError('supplierName')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.displayName"
        label="顯示名稱"
        outlined
        dense
        maxlength="190"
        :error="!!props.fieldError('displayName')"
        :error-message="props.fieldError('displayName')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.defaultCurrencyCode"
        :options="currencyOptions"
        emit-value
        map-options
        label="Default Currency *"
        aria-label="Default Currency *"
        outlined
        dense
        :loading="loadingOptions"
        :error="!!props.fieldError('defaultCurrencyCode')"
        :error-message="props.fieldError('defaultCurrencyCode')"
        @update:model-value="selectCurrency"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.defaultPaymentTermId"
        :options="paymentTermOptions"
        emit-value
        map-options
        clearable
        label="預設付款條件（選填）"
        aria-label="預設付款條件（選填）"
        outlined
        dense
        :loading="loadingOptions"
        @update:model-value="selectPaymentTerm"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input v-model="model.generalPhone" label="一般電話（選填）" outlined dense maxlength="50" />
    </div>
    <div class="col-12 col-md-6">
      <q-input v-model="model.generalEmail" label="一般電郵（選填）" type="email" outlined dense maxlength="254" />
    </div>
    <div class="col-12 col-md-6">
      <q-input v-model="model.website" label="網站（選填）" type="url" outlined dense maxlength="500" />
    </div>
    <div class="col-12">
      <q-input v-model="model.notes" label="備註（選填）" type="textarea" outlined dense maxlength="2000" autogrow />
    </div>
  </div>
</template>
