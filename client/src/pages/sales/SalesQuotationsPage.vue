<script>
export const page = { name: "sales-quotations", path: "/sales/quotations", title: "報價單", requires: { permissions: ["sales.view"] } };
</script>
<script setup>
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { useRoute,useRouter } from "vue-router";
import appConfig from "@config/app.js";
import PageHeader from "@/framework/layout/PageHeader.vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { can } from "@/framework/authorization/can.js";
import { useSessionStore } from "@/stores/session.js";
import sales from "@/services/sales.js";
const route=useRoute(),router=useRouter(),session=useSessionStore();
const manage=computed(()=>can(session,{permissions:["sales.mgmt"]}));
const filters=reactive({q:"",status:null,quotationDateFrom:"",quotationDateTo:"",validUntilFrom:"",validUntilTo:""});
watch(()=>route.query,query=>{for(const key of Object.keys(filters))filters[key]=query[key]??(key==="status"?null:"");},{immediate:true});
const statuses=[{value:"DRAFT",label:"草稿"},{value:"ISSUED",label:"已發出"},{value:"EXPIRED",label:"已過期"},{value:"CANCELLED",label:"已取消"},{value:"CONVERTED",label:"已轉單"}];
const labels=Object.fromEntries(statuses.map(row=>[row.value,row.label]));
const colors={DRAFT:"grey",ISSUED:"positive",EXPIRED:"warning",CANCELLED:"negative",CONVERTED:"primary"};
const columns=[{name:"number",label:"報價編號",field:"number",align:"left",sortable:true},{name:"customerName",label:"客戶",field:"customerName",align:"left",sortable:true},
 {name:"quotationDate",label:"報價日期",field:"quotationDate",sortable:true},{name:"validUntil",label:"有效至",field:"validUntil",sortable:true},{name:"status",label:"狀態",field:"status",sortable:true},
 {name:"totalAmount",label:"總額",field:"totalAmount",align:"right",sortable:true},{name:"actions",label:"操作",align:"right"}];
const controller=new AbortController();onBeforeUnmount(()=>controller.abort());
function fetchRows(params){return sales.listQuotations({...params,...Object.fromEntries(Object.entries(route.query).filter(([key,value])=>key in filters && key!=="q" && value)),filter:route.query.q??"",signal:controller.signal});}
function apply(){router.replace({query:Object.fromEntries(Object.entries(filters).filter(([,value])=>value))});}
</script>
<template><div><PageHeader><template #actions><q-btn v-if="manage" color="primary" label="新增報價" to="/sales/quotations/new" /></template></PageHeader>
 <div class="q-px-md q-pb-md"><div class="row q-col-gutter-md">
  <div class="col-12 col-md-4"><q-input v-model="filters.q" label="報價編號／客戶" aria-label="報價編號／客戶" maxlength="190" outlined dense @keyup.enter="apply" /></div>
  <div class="col-12 col-md-2"><q-select v-model="filters.status" :options="statuses" label="狀態" clearable emit-value map-options outlined dense /></div>
  <div v-for="(label,key) in {quotationDateFrom:'報價日期由',quotationDateTo:'報價日期至',validUntilFrom:'有效日期由',validUntilTo:'有效日期至'}" :key="key" class="col-12 col-md-3"><q-input v-model="filters[key]" :label="label" type="date" outlined dense /></div>
 </div><q-btn class="q-mt-md" label="搜尋" color="primary" @click="apply" /></div>
 <div class="q-px-md q-pb-md" aria-live="polite"><DataTable :key="JSON.stringify(route.query)" :fetch="fetchRows" :columns="columns" sticky-actions :initial-pagination="{page:1,rowsPerPage:appConfig.defaultPageSize,rowsNumber:0,sortBy:'quotationDate',descending:true}">
  <template #body-cell-customerName="{row}"><EllipsisCell :text="`${row.customerCode} — ${row.customerName}`" /></template>
  <template #body-cell-status="{row}"><q-td><q-badge :color="colors[row.status]" :label="labels[row.status]" /></q-td></template>
  <template #body-cell-totalAmount="{row}"><q-td class="text-right">{{ row.currencyCode }} {{ row.totalAmount }}</q-td></template>
  <template #body-cell-actions="{row}"><q-td class="text-right"><q-btn flat :label="`查看 ${row.number}`" :to="`/sales/quotations/${row.id}`" /></q-td></template>
  <template #no-data><p role="status">沒有符合條件的報價單；請調整搜尋條件。</p></template>
 </DataTable></div></div></template>
