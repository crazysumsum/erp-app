<script setup>
import SkuBarcodeEditor from "./SkuBarcodeEditor.vue";
import SkuUomEditor from "./SkuUomEditor.vue";
import SuggestedPriceField from "./SuggestedPriceField.vue";
import TrackingPolicyFields from "./TrackingPolicyFields.vue";

const model = defineModel({ required: true });

defineProps({
  fieldError: { type: Function, default: () => "" },
  readonly: { type: Boolean, default: false },
  // SKU Code 一建立咗就 readonly（design_spec §7.4：「SKU Code 在建立後
  // readonly；特批修改從獨立 action 開啟高強度 dialog」）——同上面成體嘅
  // `readonly`（睇緊定改緊）獨立：SkuDetailPage.vue 就算撳咗「編輯」，
  // SKU Code 都仲係唔畀改，所以要分開一個 prop，唔可以淨係跟 `readonly`。
  skuCodeReadonly: { type: Boolean, default: false }
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
          :readonly="readonly || skuCodeReadonly"
          :error="!!fieldError('skuCode')"
          :error-message="fieldError('skuCode')"
        />
      </div>
      <div class="col-12 col-md-6">
        <q-input
          v-model="model.skuName"
          label="SKU 名稱 *"
          outlined
          dense
          :readonly="readonly"
          :error="!!fieldError('skuName')"
          :error-message="fieldError('skuName')"
        />
      </div>
    </div>

    <div class="row q-col-gutter-md items-center">
      <div class="col-auto">
        <q-checkbox v-model="model.purchasable" label="可採購" :disable="readonly" />
      </div>
      <div class="col-auto">
        <q-checkbox v-model="model.sellable" label="可銷售" :disable="readonly" />
      </div>
      <div class="col-auto">
        <q-checkbox v-model="model.inventoryTracked" label="計入庫存" :disable="readonly" />
      </div>
    </div>

    <SuggestedPriceField
      v-model="model.suggestedPriceAmount"
      :error-message="fieldError('suggestedPriceAmount')"
      :readonly="readonly"
    />

    <TrackingPolicyFields v-model="model" :field-error="fieldError" :readonly="readonly" />

    <SkuUomEditor v-model="model.uoms" :field-error="fieldError" :readonly="readonly" />

    <SkuBarcodeEditor v-model="model.barcodes" :uoms="model.uoms" :field-error="fieldError" :readonly="readonly" />
  </div>
</template>
