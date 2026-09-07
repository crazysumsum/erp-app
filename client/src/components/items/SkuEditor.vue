<script setup>
import SkuBarcodeEditor from "./SkuBarcodeEditor.vue";
import SkuUomEditor from "./SkuUomEditor.vue";
import SuggestedPriceField from "./SuggestedPriceField.vue";
import TrackingPolicyFields from "./TrackingPolicyFields.vue";

const model = defineModel({ required: true });

defineProps({
  fieldError: { type: Function, default: () => "" }
});
</script>

<template>
  <div class="q-gutter-md">
    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-6">
        <q-input
          v-model="model.skuCode"
          label="SKU Code *"
          outlined
          dense
          hint="人手輸入，建立後不可修改；不分大小寫全域唯一"
          :error="!!fieldError('skus.0.skuCode')"
          :error-message="fieldError('skus.0.skuCode')"
        />
      </div>
      <div class="col-12 col-md-6">
        <q-input
          v-model="model.skuName"
          label="SKU 名稱 *"
          outlined
          dense
          :error="!!fieldError('skus.0.skuName')"
          :error-message="fieldError('skus.0.skuName')"
        />
      </div>
    </div>

    <div class="row q-col-gutter-md items-center">
      <div class="col-auto">
        <q-checkbox v-model="model.purchasable" label="可採購" />
      </div>
      <div class="col-auto">
        <q-checkbox v-model="model.sellable" label="可銷售" />
      </div>
      <div class="col-auto">
        <q-checkbox v-model="model.inventoryTracked" label="計入庫存" />
      </div>
    </div>

    <SuggestedPriceField
      v-model="model.suggestedPriceAmount"
      :error-message="fieldError('skus.0.suggestedPriceAmount')"
    />

    <TrackingPolicyFields v-model="model" :field-error="fieldError" />

    <SkuUomEditor v-model="model.uoms" :field-error="fieldError" />

    <SkuBarcodeEditor v-model="model.barcodes" :uoms="model.uoms" :field-error="fieldError" />
  </div>
</template>
