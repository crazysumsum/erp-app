import { effectScope } from "vue";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
vi.mock("@/services/sales.js",()=>({default:{confirmOrder:vi.fn(),getOperation:vi.fn(),getOrder:vi.fn()}}));
import sales from "@/services/sales.js";
import { useSalesCommandEvent } from "@/composables/sales/useSalesCommandEvent.js";
const uuid="11111111-1111-4111-8111-111111111111",key="sales.confirm:7:8";
let scope,command,terminal;
function open(userId=7){scope=effectScope();terminal=vi.fn();command=scope.run(()=>useSalesCommandEvent({userId:()=>userId,onTerminal:terminal}));return command;}
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();sessionStorage.clear();sales.confirmOrder.mockResolvedValue({outcome:"CONFIRMING",retryAfterSeconds:2});sales.getOperation.mockResolvedValue({status:"IN_PROGRESS"});});
afterEach(()=>{scope?.stop();vi.useRealTimers();vi.restoreAllMocks();});
describe("TC-022 durable confirmation intent",()=>{
 it("persists only original event/version per actor/order before sending and prevents duplicate click",async()=>{
  open();let resolve;sales.confirmOrder.mockImplementation(()=>new Promise(done=>{resolve=done;}));const work=command.start(8,3);await Promise.resolve();
  const stored=JSON.parse(sessionStorage.getItem(key));expect(Object.keys(stored).sort()).toEqual(["eventId","version"]);expect(stored.version).toBe(3);
  await command.start(8,3);expect(sales.confirmOrder).toHaveBeenCalledTimes(1);expect(sales.confirmOrder).toHaveBeenCalledWith(8,stored,expect.anything());
  resolve({outcome:"CONFIRMING",retryAfterSeconds:2});await work;expect(command.pending.value).toBe(true);
 });
 it("clears intent only after synchronous terminal200 and reports warnings",async()=>{
  open();sales.confirmOrder.mockResolvedValue({outcome:"CONFIRMED",warnings:["PARTIAL_BACKORDER"]});await command.start(8,3);
  expect(sessionStorage.getItem(key)).toBeNull();expect(command.pending.value).toBe(false);expect(terminal).toHaveBeenCalledWith(expect.objectContaining({status:"SUCCEEDED",warnings:["PARTIAL_BACKORDER"]}));
 });
 it("polls202 sequentially, retains UUID, and clears on terminal success",async()=>{
  open();await command.start(8,3);const stored=JSON.parse(sessionStorage.getItem(key));await vi.advanceTimersByTimeAsync(2000);
  expect(sales.getOperation).toHaveBeenCalledWith(stored.eventId,expect.anything());expect(sessionStorage.getItem(key)).not.toBeNull();
  sales.getOperation.mockResolvedValue({status:"SUCCEEDED",result:{id:8}});await vi.advanceTimersByTimeAsync(2000);expect(sessionStorage.getItem(key)).toBeNull();expect(terminal).toHaveBeenCalledWith({status:"SUCCEEDED",result:{id:8}});
 });
 it("network uncertainty preserves original UUID and polls rather than repeating effects",async()=>{
  open();sales.confirmOrder.mockRejectedValue(new Error("network lost"));await command.start(8,3);const stored=JSON.parse(sessionStorage.getItem(key));
  expect(command.error.value).toContain("未確定");await vi.advanceTimersByTimeAsync(2000);expect(sales.getOperation).toHaveBeenCalledWith(stored.eventId,expect.anything());expect(sales.confirmOrder).toHaveBeenCalledTimes(1);
 });
 it("refresh resumes this actor's saved intent without POST",async()=>{
  sessionStorage.setItem(key,JSON.stringify({eventId:uuid,version:3}));open();await command.resume(8);expect(sales.getOperation).toHaveBeenCalledWith(uuid,expect.anything());expect(sales.confirmOrder).not.toHaveBeenCalled();expect(command.pending.value).toBe(true);
 });
 it("does not use another actor's saved event",async()=>{
  sessionStorage.setItem(key,JSON.stringify({eventId:uuid,version:3}));open(9);await command.resume(8);expect(sales.getOperation).not.toHaveBeenCalled();expect(sessionStorage.getItem(key)).not.toBeNull();
 });
 it("missing operation stops auto polling and explicit retry submits the same UUID after lookup",async()=>{
  sessionStorage.setItem(key,JSON.stringify({eventId:uuid,version:3}));open();sales.getOperation.mockRejectedValue({status:404,code:"SALES_ORDER_NOT_FOUND"});await command.resume(8);await vi.advanceTimersByTimeAsync(8000);
  expect(sales.getOperation).toHaveBeenCalledTimes(1);expect(sales.confirmOrder).not.toHaveBeenCalled();expect(command.error.value).toContain("原操作");
  await command.retry();expect(sales.getOperation).toHaveBeenCalledTimes(2);expect(sales.confirmOrder).toHaveBeenCalledWith(8,{eventId:uuid,version:3},expect.anything());
 });
 it("terminal failed qualification clears event, reports failure, and leaves no timer",async()=>{
  open();await command.start(8,3);sales.getOperation.mockResolvedValue({status:"FAILED",errorCode:"CUSTOMER_ON_HOLD"});await vi.advanceTimersByTimeAsync(2000);
  expect(sessionStorage.getItem(key)).toBeNull();expect(terminal).toHaveBeenCalledWith({status:"FAILED",errorCode:"CUSTOMER_ON_HOLD"});expect(vi.getTimerCount()).toBe(0);
 });
 it("permission rejection stops polling, retains intent and never retries a write automatically",async()=>{
  open();await command.start(8,3);sales.getOperation.mockRejectedValue({status:403,message:"permission revoked"});await vi.advanceTimersByTimeAsync(2000);await vi.advanceTimersByTimeAsync(8000);
  expect(command.error.value).toContain("permission revoked");expect(sessionStorage.getItem(key)).not.toBeNull();expect(sales.getOperation).toHaveBeenCalledTimes(1);expect(sales.confirmOrder).toHaveBeenCalledTimes(1);
 });
 it("navigation/unmount aborts lookup and prevents late result from clearing pending intent",async()=>{
  sessionStorage.setItem(key,JSON.stringify({eventId:uuid,version:3}));open();let resolve,signal;sales.getOperation.mockImplementation((_id,options)=>{signal=options.signal;return new Promise(done=>{resolve=done;});});const work=command.resume(8);scope.stop();resolve({status:"SUCCEEDED"});await work;
  expect(signal.aborted).toBe(true);expect(sessionStorage.getItem(key)).not.toBeNull();expect(terminal).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
 });
 it("storage failure prevents POST so the user cannot lose an unknown command identity",async()=>{
  open();vi.spyOn(Object.getPrototypeOf(sessionStorage),"setItem").mockImplementation(()=>{throw new Error("storage disabled");});await command.start(8,3);expect(sales.confirmOrder).not.toHaveBeenCalled();expect(command.error.value).toContain("保存");
 });
 it("rejects corrupt saved intent without silently generating a replacement",async()=>{
  sessionStorage.setItem(key,JSON.stringify({eventId:"bad",version:"3"}));open();await command.resume(8);expect(sales.getOperation).not.toHaveBeenCalled();expect(sales.confirmOrder).not.toHaveBeenCalled();expect(command.error.value).toContain("原操作");
 });
 it("snapshot404 and Draft cannot authorize abandonment or erase an original uncommitted event",async()=>{
  sessionStorage.setItem(key,JSON.stringify({eventId:uuid,version:3}));open();sales.getOperation.mockRejectedValue({status:404});await command.resume(8);
  expect(command.abandon).toBeUndefined();expect(sessionStorage.getItem(key)).toBe(JSON.stringify({eventId:uuid,version:3}));expect(sales.getOrder).not.toHaveBeenCalled();expect(command.pending.value).toBe(true);
 });
 it("same-event definitive stale-version rejection reloads known rejected facts and allows a later fresh intent",async()=>{
  open();sales.confirmOrder.mockRejectedValue({status:409,code:"VERSION_CONFLICT"});await command.start(8,3);
  expect(terminal).toHaveBeenCalledWith({status:"REJECTED",errorCode:"VERSION_CONFLICT"});expect(sessionStorage.getItem(key)).toBeNull();expect(command.pending.value).toBe(false);expect(vi.getTimerCount()).toBe(0);
 });
 it("render/refresh failure after terminal200 does not relabel committed confirmation as unknown or start polling",async()=>{
  open();terminal.mockRejectedValue(new Error("detail reload unavailable"));sales.confirmOrder.mockResolvedValue({outcome:"CONFIRMED",warnings:[]});await command.start(8,3);
  expect(command.error.value).toContain("結果已確定");expect(command.pending.value).toBe(false);expect(sessionStorage.getItem(key)).toBeNull();await vi.advanceTimersByTimeAsync(8000);expect(sales.getOperation).not.toHaveBeenCalled();
 });
 it("late terminal refresh rejection cannot write an error into a new order or actor context",async()=>{
  let actor=7;scope=effectScope();terminal=vi.fn();command=scope.run(()=>useSalesCommandEvent({userId:()=>actor,onTerminal:terminal}));
  let reject;terminal.mockImplementation(()=>new Promise((_done,fail)=>{reject=fail;}));sales.confirmOrder.mockResolvedValue({outcome:"CONFIRMED",warnings:[]});const work=command.start(8,3);await Promise.resolve();
  actor=9;await command.resume(9);reject(new Error("old detail refresh failed"));await work;expect(command.error.value).toBe("");expect(command.pending.value).toBe(false);
 });
});
