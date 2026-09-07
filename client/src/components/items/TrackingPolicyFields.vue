<script setup>
import { TRACKING_POLICY_LABEL } from "./itemFieldLabels.js";

const model = defineModel({ required: true });

defineProps({
  fieldError: { type: Function, default: () => "" }
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
        :error="!!fieldError('skus.0.trackingPolicy')"
        :error-message="fieldError('skus.0.trackingPolicy')"
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
          :error="!!fieldError('skus.0.shelfLifeDays')"
          :error-message="fieldError('skus.0.shelfLifeDays')"
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
          :error="!!fieldError('skus.0.minReceiptLifeDays')"
          :error-message="fieldError('skus.0.minReceiptLifeDays')"
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
          :error="!!fieldError('skus.0.minSaleLifeDays')"
          :error-message="fieldError('skus.0.minSaleLifeDays')"
        />
      </div>
    </template>
  </div>
</template>
