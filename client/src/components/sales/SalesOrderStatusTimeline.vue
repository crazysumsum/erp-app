<script setup>
import {statusLabels} from "./salesOrderPresentation.js";
defineProps({history:{type:Array,required:true},truncated:{type:Boolean,default:false}});
function timestamp(value){return new Intl.DateTimeFormat("zh-HK",{timeZone:"Asia/Hong_Kong",dateStyle:"short",timeStyle:"short"}).format(new Date(value));}
</script>
<template><section aria-labelledby="sales-status-history"><h2 id="sales-status-history" class="text-h6 q-ma-none q-mb-md">狀態歷史</h2><p v-if="truncated" role="status">只顯示最近 100 項狀態歷史。</p><ol><li v-for="event in history" :key="event.id" class="q-mb-sm history-event">{{ timestamp(event.occurredAt) }} — {{ event.actorLabel }}：{{ event.fromStatus?`${statusLabels[event.fromStatus]} → `:'' }}{{ statusLabels[event.toStatus] }}；{{ event.action }}；版本 {{ event.version }}<span v-if="event.reason">；{{ event.reason }}</span></li></ol><p v-if="!history.length" role="status">沒有狀態歷史。</p></section></template>
<style scoped>.history-event { overflow-wrap:anywhere; }</style>
