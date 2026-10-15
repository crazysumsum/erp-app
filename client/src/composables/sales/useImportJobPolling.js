import {onScopeDispose,ref,toValue,watch} from "vue";
import sales from "@/services/sales.js";
const running=new Set(["UPLOADED","VALIDATING","QUEUED","PROCESSING"]);
export function useImportJobPolling({jobId,actorId}) {
 const job=ref(null),error=ref(null),loading=ref(false);let timer,controller,generation=0,failures=0,processingSince=null,disposed=false;
 function stop(){generation++;clearTimeout(timer);controller?.abort();loading.value=false;}
 async function refresh(){
  stop();if(disposed||document.hidden||!toValue(jobId)||!toValue(actorId))return;
  const current=generation;controller=new AbortController();const signal=controller.signal;loading.value=true;error.value=null;
  try{const value=await sales.getImport(Number(toValue(jobId)),{signal});if(current!==generation)return;job.value=value;failures=0;processingSince=value.status==="PROCESSING"?(processingSince??Date.now()):null;}
  catch(cause){if(current!==generation||signal.aborted)return;error.value=cause;failures++;}
  finally{if(current===generation){loading.value=false;if(!document.hidden&&(!error.value?running.has(job.value?.status):![401,403,404].includes(error.value.status)))timer=setTimeout(refresh,error.value?Math.min(30000,2000*2**Math.min(failures,4)):processingSince!==null&&Date.now()-processingSince>=60000?5000:2000);}}
 }
 function visibility(){if(document.hidden)stop();else refresh();}
 watch(()=>[toValue(jobId),toValue(actorId)],()=>{job.value=null;failures=0;processingSince=null;refresh();},{immediate:true});
 document.addEventListener("visibilitychange",visibility);
 onScopeDispose(()=>{disposed=true;stop();document.removeEventListener("visibilitychange",visibility);});
 return {job,error,loading,refresh};
}
