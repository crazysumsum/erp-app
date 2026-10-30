import {onBeforeUnmount,ref,watch} from "vue";
import {useRoute,useRouter} from "vue-router";
import fulfillment,{normalizeFulfillmentQuery,fulfillmentFailure} from "@/services/fulfillment.js";
export function useFulfillmentPage(kind){
 const route=useRoute(),router=useRouter(),data=ref({items:[],page:1,hasMore:false,nextCursor:null}),loading=ref(false),error=ref("");let controller;
 async function load(){controller?.abort();controller=new AbortController();const signal=controller.signal;loading.value=true;error.value="";
  try{const query=normalizeFulfillmentQuery(kind,route.query),result=await fulfillment[kind==="queue"?"listQueue":"listFulfillments"]({...query,signal});if(!signal.aborted)data.value=result;}
  catch(e){if(!signal.aborted){data.value={items:[],page:1,hasMore:false,nextCursor:null};const failure=fulfillmentFailure(e);error.value=e instanceof TypeError?"篩選資料不正確，請清除篩選後再試":failure.action==="recover"?"暫時無法載入履約資料，請保留篩選並重新載入":failure.message;}}
  finally{if(!signal.aborted)loading.value=false;}
 }
 function apply(filters){try{return router.replace({query:normalizeFulfillmentQuery(kind,{...filters,page:1,cursor:undefined})});}catch{error.value="篩選資料不正確，請檢查後再試";}}
 function next(){if(!loading.value&&data.value.hasMore&&data.value.nextCursor)return router.push({query:{...route.query,page:String(data.value.page+1),cursor:data.value.nextCursor}});}
 function first(){return router.push({query:{...route.query,page:"1",cursor:undefined}});}
 watch(()=>route.fullPath,load,{immediate:true});onBeforeUnmount(()=>controller?.abort());return {route,data,loading,error,load,apply,next,first};
}
