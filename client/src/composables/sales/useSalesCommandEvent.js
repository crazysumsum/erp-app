import { onScopeDispose,ref } from "vue";
import sales from "@/services/sales.js";

// Session storage survives refresh; only an unresolved command identity is retained.
export function useSalesCommandEvent({ userId,onTerminal }) {
  const pending=ref(false),busy=ref(false),error=ref(""),retryable=ref(false);
  let intent,orderId,actorId,controller,timer;
  const key=()=>`sales.confirm:${actorId}:${orderId}`;
  function stop(){clearTimeout(timer);controller?.abort();busy.value=false;}
  onScopeDispose(stop);
  function active(signal){return !signal.aborted && actorId===userId();}
  function schedule(signal,seconds=2){if(active(signal))timer=setTimeout(()=>poll(signal),seconds*1000);}
  async function finish(operation,signal){
    if(!active(signal))return;
    clearTimeout(timer);intent=null;pending.value=false;retryable.value=false;error.value="";
    try{sessionStorage.removeItem(key());}catch{error.value="操作結果已確定，但未能清除分頁的操作記錄；請重新查閱訂單。";}
    try{await onTerminal(operation);}catch{if(active(signal))error.value="操作結果已確定，但重新載入訂單失敗；請重新載入訂單。";}
  }
  function read(id){
    stop();orderId=id;actorId=userId();controller=new AbortController();error.value="";retryable.value=false;pending.value=false;intent=null;
    try{
      const saved=sessionStorage.getItem(key());if(!saved)return true;
      pending.value=true;const value=JSON.parse(saved);
      if(!value||Object.keys(value).length!==2||!Number.isSafeInteger(value.version)||value.version<1||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.eventId))throw new Error();
      intent=value;return true;
    }catch{error.value="無法讀取原操作；請先核對訂單狀態，勿建立另一個確認操作。";return false;}
  }
  async function poll(signal,{resubmit=false}={}){
    if(!active(signal)||!intent)return;
    busy.value=true;retryable.value=false;
    try{
      const operation=await sales.getOperation(intent.eventId,{signal});if(!active(signal))return;
      if(operation.status==="SUCCEEDED"||operation.status==="FAILED")await finish(operation,signal);
      else schedule(signal);
    }catch(e){
      if(!active(signal))return;
      if(e.status===404){
        if(resubmit)await send(signal);
        else{error.value="尚未找到原操作；可重查並使用同一操作重試。";retryable.value=true;}
      }else if(e.status===401||e.status===403){error.value=e.message||"權限已失效，請重新登入並核對權限。";}
      else{error.value="確認結果未確定，正在查詢原操作。";schedule(signal);}
    }finally{if(active(signal))busy.value=false;}
  }
  async function send(signal){
    busy.value=true;retryable.value=false;
    try{
      const result=await sales.confirmOrder(orderId,intent,{signal});if(!active(signal))return;
      if(result.outcome==="CONFIRMED")await finish({status:"SUCCEEDED",result:result.salesOrder,warnings:result.warnings},signal);
      else if(result.outcome==="CONFIRMING")schedule(signal,result.retryAfterSeconds);
      else throw new Error("Unknown confirmation outcome");
    }catch(e){
      if(!active(signal))return;
      if(e.status===401||e.status===403)error.value=e.message||"權限已失效，請重新登入並核對權限。";
      else{error.value=e.status&&e.status<500?e.message||"確認遭拒，正在核對原操作。":"確認結果未確定，正在查詢原操作。";schedule(signal);}
    }finally{if(active(signal))busy.value=false;}
  }
  async function start(id,version){
    if(busy.value||pending.value)return;
    if(!read(id))return;
    if(intent)return poll(controller.signal);
    try{
      intent={eventId:crypto.randomUUID(),version};sessionStorage.setItem(key(),JSON.stringify(intent));pending.value=true;
    }catch{intent=null;error.value="無法保存確認操作，請允許此分頁儲存後再試。";return;}
    await send(controller.signal);
  }
  async function resume(id){if(read(id)&&intent)await poll(controller.signal);}
  async function retry(){if(busy.value||!intent||!retryable.value)return;stop();controller=new AbortController();error.value="";await poll(controller.signal,{resubmit:true});}
  async function abandon(){
    if(busy.value||!intent||!retryable.value)return;
    stop();controller=new AbortController();const signal=controller.signal;busy.value=true;
    try{
      try{const operation=await sales.getOperation(intent.eventId,{signal});if(!active(signal))return;
        if(operation.status==="SUCCEEDED"||operation.status==="FAILED")await finish(operation,signal);
        else error.value="原操作仍在處理，不能放棄。";
      }catch(e){
        if(!active(signal))return;if(e.status!==404)throw e;
        const order=await sales.getOrder(orderId,{signal});if(!active(signal))return;
        if(order.status!=="DRAFT"){error.value="訂單狀態已變更，請先核對原操作。";return;}
        await finish({status:"NOT_COMMITTED",result:order},signal);
      }
    }catch(e){if(active(signal))error.value=e.message||"無法核對訂單狀態，原操作已保留。";}
    finally{if(active(signal))busy.value=false;}
  }
  return {pending,busy,error,retryable,start,resume,retry,abandon,stop};
}
