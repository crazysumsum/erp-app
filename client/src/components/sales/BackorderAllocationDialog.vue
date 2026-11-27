<script setup>
import {onBeforeUnmount,ref,watch} from "vue";
import sales from "@/services/sales.js";
const props=defineProps({modelValue:Boolean,orderId:Number,userId:Number,enabled:Boolean}),emit=defineEmits(["update:modelValue","accepted"]);
const busy=ref(false),error=ref("");let controller,key;
function stop(){controller?.abort();busy.value=false;}
watch(()=>props.modelValue,value=>{stop();if(value){key=crypto.randomUUID();error.value="";}},{immediate:true});
watch([()=>props.orderId,()=>props.userId,()=>props.enabled],()=>{stop();emit("update:modelValue",false);});
onBeforeUnmount(stop);
async function submit(){
 if(busy.value||!props.enabled||!props.modelValue)return;controller=new AbortController();const signal=controller.signal;busy.value=true;error.value="";
 try{await sales.runBackorderAllocation({orderId:props.orderId},{idempotencyKey:key,signal});if(!signal.aborted){emit("update:modelValue",false);emit("accepted");}}
 catch(e){if(!signal.aborted)error.value=e.message||"未能確認補配是否已安排，請重試。";}
 finally{if(!signal.aborted)busy.value=false;}
}
</script>
<template><q-dialog :model-value="modelValue" :persistent="busy" aria-labelledby="sales-backorder-title" @update:model-value="emit('update:modelValue',$event)"><q-card class="allocation-dialog"><q-card-section>
 <h2 id="sales-backorder-title" class="text-h6 q-ma-none q-mb-md">安排欠貨補配</h2>
 <p>同一倉庫內的同一商品規格，會先補配較早確認的訂單，再按明細順序補配。</p>
 <p>安排補配後，庫存不足的數量會保留為欠貨，等待下一輪。請重新讀取訂單查看已預留及欠貨數量。</p>
 <q-banner v-if="error" role="alert" class="bg-negative text-white">{{ error }}</q-banner>
 </q-card-section><q-card-actions align="right"><q-btn flat label="返回" :disable="busy" @click="emit('update:modelValue',false)" /><q-btn color="primary" label="提交補配申請" :loading="busy" :disable="!enabled" @click="submit" /></q-card-actions></q-card></q-dialog></template>
<style scoped>.allocation-dialog { width:100%; max-width:36rem; overflow-wrap:anywhere; }</style>
