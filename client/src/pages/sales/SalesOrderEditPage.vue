<script>
export const page={name:"sales-order-edit",path:"/sales/orders/:id/edit",title:"編輯銷售訂單",requires:{permissions:["sales.view","sales.mgmt"]}};
</script>
<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import SalesOrderForm from "@/components/sales/SalesOrderForm.vue";
import sales from "@/services/sales.js";
const route=useRoute(),document=ref(null),loading=ref(false),error=ref(""),savedVersion=ref(null);let controller;
async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";document.value=null;
 try{const result=await sales.getOrder(Number(route.params.id),{signal});if(!signal.aborted)document.value=result;}
 catch(e){if(!signal.aborted)error.value=e.message||"載入銷售訂單失敗";}finally{if(!signal.aborted)loading.value=false;}}
watch(()=>route.params.id,()=>{savedVersion.value=null;load();},{immediate:true});onBeforeUnmount(()=>controller?.abort());
async function save(payload){return sales.updateOrder(document.value.id,payload);}
async function saved(){await load();if(document.value)savedVersion.value=document.value.version;}
</script>
<template><div><PageHeader :title="document?`編輯 ${document.number}`:'編輯銷售訂單'" /><main class="q-px-md q-pb-md">
 <q-skeleton v-if="loading" type="rect" aria-label="載入銷售訂單" />
 <q-banner v-else-if="error" role="alert" class="bg-negative text-white">{{ error }}<template #action><q-btn flat label="重試" @click="load" /></template></q-banner>
 <template v-else-if="document"><q-banner v-if="savedVersion!==null" role="status" class="bg-positive text-dark q-mb-md">銷售訂單已儲存；已重新讀取最新版本 {{ savedVersion }}。</q-banner>
  <SalesOrderForm v-if="document.allowedActions.includes('edit')" :document="document" :on-save="save" @saved="saved" @reload="load" />
  <q-banner v-else role="status">目前狀態或權限不允許此操作。<q-btn flat label="返回訂單詳情" :to="`/sales/orders/${document.id}`" /></q-banner>
 </template>
 </main></div></template>
