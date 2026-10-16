<script>
export const page={name:"sales-archive",path:"/sales/archive",title:"封存銷售訂單",requires:{permissions:["sales.view"]},menu:{group:"salesOrderManagement",icon:"archive",order:50}};
</script>
<script setup>
import {computed,reactive} from "vue";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SalesExportButton from "@/components/sales/SalesExportButton.vue";
const fields=reactive({number:"",externalOrderId:"",customerId:"",orderDateFrom:"",orderDateTo:""});
const filters=computed(()=>Object.fromEntries(Object.entries(fields).filter(([,value])=>value!=="")));
const bounded=computed(()=>{const {number,externalOrderId,customerId,orderDateFrom:from,orderDateTo:to}=fields;if(customerId&&!/^[1-9]\d*$/u.test(customerId))return false;if(Boolean(from)!==Boolean(to))return false;const days=(Date.parse(to)-Date.parse(from))/86400000+1;if(from&&(!Number.isFinite(days)||days<1||days>366))return false;return Boolean(number||externalOrderId||customerId||from);});
</script>
<template><div><PageHeader title="封存銷售訂單" subtitle="Archive 查詢與匯出只讀取封存資料；Active 訂單請返回訂單列表。"><template #actions><q-btn flat label="Active 訂單" to="/sales/orders" /><q-btn flat label="我的匯出工作" to="/sales/exports" /></template></PageHeader><div class="q-pa-md"><p>請指定精確訂單編號、精確 External ID、客戶 ID，或最多 366 天的完整日期範圍。</p><div class="row q-col-gutter-md"><div class="col-12 col-md-4"><q-input v-model="fields.number" label="訂單編號（精確）" maxlength="20" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.externalOrderId" label="External Order ID（精確）" maxlength="190" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.customerId" label="客戶 ID" aria-label="客戶 ID" inputmode="numeric" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.orderDateFrom" label="訂單日期由" aria-label="訂單日期由" type="date" outlined dense /></div><div class="col-12 col-md-4"><q-input v-model="fields.orderDateTo" label="訂單日期至" aria-label="訂單日期至" type="date" outlined dense /></div></div><p v-if="!bounded" role="status">請提供有效的封存篩選；日期須成對且不超過 366 天。</p><div class="q-mt-md"><SalesExportButton scope="ARCHIVE" :filters="filters" :disabled="!bounded" /></div></div></div></template>
