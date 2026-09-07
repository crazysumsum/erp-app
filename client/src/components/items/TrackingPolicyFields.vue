<script setup>
import { TRACKING_POLICY_LABEL } from "./itemFieldLabels.js";

const model = defineModel({ required: true });

defineProps({
  fieldError: { type: Function, default: () => "" },
  // T15 嘅 create page 唔傳，預設 false，行為不變；T17 嘅 SkuDetailPage.vue
  // 冇 item.mgmt 或者未撳「編輯」之前用嚟顯示唔畀改嘅詳情。
  readonly: { type: Boolean, default: false }
});

const policyOptions = Object.entries(TRACKING_POLICY_LABEL).map(([value, label]) => ({ label, value }));
</script>

<template>
  <div class="row q-col-gutter-md">
    <div class="col-12 col-md-4">
      <q-select
        v-model="model.trackingPolicy"
        :options="policyOptions"
        emit-value
        map-options
        label="追蹤政策"
        outlined
        dense
        :readonly="readonly"
        :disable="readonly"
        :error="!!fieldError('trackingPolicy')"
        :error-message="fieldError('trackingPolicy')"
      />
    </div>
    <template v-if="model.trackingPolicy === 'batch_expiry'">
      <div class="col-12 col-md-4">
        <q-input
          v-model.number="model.shelfLifeDays"
          type="number"
          min="1"
          label="保存期限（天）*"
          outlined
          dense
          :readonly="readonly"
          :error="!!fieldError('shelfLifeDays')"
          :error-message="fieldError('shelfLifeDays')"
        />
      </div>
      <div class="col-12 col-md-4">
        <q-input
          v-model.number="model.minReceiptLifeDays"
          type="number"
          min="0"
          label="最短到貨可用天數"
          outlined
          dense
          :readonly="readonly"
          :error="!!fieldError('minReceiptLifeDays')"
          :error-message="fieldError('minReceiptLifeDays')"
        />
      </div>
      <div class="col-12 col-md-4">
        <q-input
          v-model.number="model.minSaleLifeDays"
          type="number"
          min="0"
          label="最短銷售可用天數"
          outlined
          dense
          :readonly="readonly"
          :error="!!fieldError('minSaleLifeDays')"
          :error-message="fieldError('minSaleLifeDays')"
        />
      </div>
    </template>
  </div>
</template>
