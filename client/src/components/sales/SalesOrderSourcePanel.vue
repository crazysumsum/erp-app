<script setup>
import {sourceLabels} from "./salesOrderPresentation.js";
defineProps({order:{type:Object,required:true}});
</script>
<template><q-card flat bordered class="q-my-md"><q-card-section><h2 class="text-h6 q-ma-none q-mb-md">來源</h2><p>{{ sourceLabels[order.sourceType] }}</p><q-btn v-if="order.sourceQuotationId" flat label="返回來源報價" :to="`/sales/quotations/${order.sourceQuotationId}`" /><p v-if="order.externalOrderId" class="source-identity">{{ order.channelCode }}／{{ order.externalOrderId }}</p></q-card-section></q-card></template>
<style scoped>.source-identity { overflow-wrap:anywhere; }</style>
