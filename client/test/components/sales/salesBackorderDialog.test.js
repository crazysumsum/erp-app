import {flushPromises,mount} from "@vue/test-utils";
import {Quasar} from "quasar";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("@/services/sales.js",()=>({default:{runBackorderAllocation:vi.fn()}}));
import sales from "@/services/sales.js";
import Dialog from "@/components/sales/BackorderAllocationDialog.vue";
let wrapper;
async function open(){wrapper=mount(Dialog,{props:{modelValue:true,orderId:8,userId:7,enabled:true},global:{plugins:[Quasar]},attachTo:document.body});await flushPromises();}
async function submit(){const button=[...document.querySelectorAll("button")].find(value=>value.textContent==="提交 FIFO 喚醒");expect(button).toBeTruthy();button.click();await flushPromises();}
beforeEach(()=>{vi.clearAllMocks();sales.runBackorderAllocation.mockResolvedValue({accepted:true});});
afterEach(()=>{wrapper?.unmount();wrapper=null;document.body.innerHTML="";});
it("TC-027 explains scope FIFO and emits acceptance without an allocation claim",async()=>{await open();expect(document.body.textContent).toContain("不保證即時配到");expect(document.body.textContent).toContain("較早確認");await submit();expect(sales.runBackorderAllocation).toHaveBeenCalledWith({orderId:8},{idempotencyKey:expect.any(String),signal:expect.any(AbortSignal)});expect(wrapper.emitted("accepted")).toHaveLength(1);expect(wrapper.emitted("update:modelValue")).toEqual([[false]]);});
it("TC-027 failed wake keeps one intent for explicit retry and leaves business quantities untouched",async()=>{sales.runBackorderAllocation.mockRejectedValueOnce(Error("排程暫不可用"));await open();await submit();expect(document.body.textContent).toContain("排程暫不可用");expect(wrapper.emitted("accepted")).toBeUndefined();const key=sales.runBackorderAllocation.mock.calls[0][1].idempotencyKey;await submit();expect(sales.runBackorderAllocation.mock.calls[1][1].idempotencyKey).toBe(key);expect(wrapper.emitted("accepted")).toHaveLength(1);});
it("TC-027 actor change and unmount abort pending request and ignore late acceptance",async()=>{let resolve;sales.runBackorderAllocation.mockImplementation(()=>new Promise(done=>{resolve=done;}));await open();await submit();const signal=sales.runBackorderAllocation.mock.calls[0][1].signal;await wrapper.setProps({userId:9});expect(signal.aborted).toBe(true);resolve({accepted:true});await flushPromises();expect(wrapper.emitted("accepted")).toBeUndefined();await wrapper.setProps({modelValue:false});await wrapper.setProps({modelValue:true});await submit();const other=sales.runBackorderAllocation.mock.calls[1][1].signal;wrapper.unmount();expect(other.aborted).toBe(true);resolve({accepted:true});await flushPromises();});
