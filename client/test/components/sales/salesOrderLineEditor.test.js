import { flushPromises, mount } from "@vue/test-utils";
import { QSelect, Quasar } from "quasar";
import { h, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/services/sales.js",()=>({default:{lookupSkus:vi.fn()}}));
import sales from "@/services/sales.js";
import LineEditor from "@/components/sales/SalesOrderLineEditor.vue";
import Summary from "@/components/sales/SalesOrderQuantitySummary.vue";
const sku={skuId:3,skuCode:"SKU3",skuName:"貨品",suggestedPrice:{amount:"3.3333",currency:"HKD"},uoms:[{skuUomId:5,uomCode:"EA",uomName:"件",isDefaultSale:true}]};
const line={skuId:3,skuUomId:5,skuCode:"SKU3",skuName:"貨品",uomCode:"EA",quantity:"2.000000",unitSellingPrice:"3.3333",lineNote:""};
let wrapper;
function editor(initial=[]){const lines=ref(initial);wrapper=mount({render:()=>h(LineEditor,{modelValue:lines.value,currencyCode:"HKD","onUpdate:modelValue":value=>{lines.value=value;}})},{global:{plugins:[Quasar]},attachTo:window.document.body});return lines;}
async function add(){wrapper.findAllComponents(QSelect).find(q=>q.props("label")==="搜尋 SKU").vm.$emit("update:modelValue",sku);await flushPromises();await wrapper.findAll("button").find(b=>b.text()==="新增明細").trigger("click");await flushPromises();}
afterEach(()=>{wrapper?.unmount();wrapper=null;vi.restoreAllMocks();window.document.body.innerHTML="";});
describe("TC-019 SO line editor and quantity summary",()=>{
 it("focuses existing SKU/UOM even at the 100-line limit",async()=>{const lines=editor([line,...Array.from({length:99},(_,i)=>({...line,skuId:30+i,skuUomId:50+i}))]);await add();expect(lines.value).toHaveLength(100);expect(window.document.activeElement).toBe(wrapper.find('[data-line-index="0"] input').element);expect(wrapper.find('[role="status"]').text()).toContain("已存在");});
 it("blocks a new 101st line and supports removing the original line",async()=>{const lines=editor(Array.from({length:100},(_,i)=>({...line,skuId:30+i,skuUomId:50+i})));await add();expect(lines.value).toHaveLength(100);expect(wrapper.findAll("button").find(b=>b.text()==="新增明細").element.disabled).toBe(true);await wrapper.findAll("button").find(b=>b.text()==="刪除明細 1").trigger("click");expect(lines.value).toHaveLength(99);});
 it("uses exact barcode lookup and currency-compatible suggested price",async()=>{const lines=editor();sales.lookupSkus.mockResolvedValue({items:[sku]});await wrapper.findAll(".q-field").find(q=>q.text().includes("條碼")).find("input").setValue("8712345678901");await wrapper.findAll("button").find(b=>b.text()==="搜尋條碼").trigger("click");await flushPromises();await wrapper.findAll("button").find(b=>b.text()==="新增明細").trigger("click");expect(sales.lookupSkus).toHaveBeenCalledWith(expect.objectContaining({q:"",barcode:"8712345678901",currencyCode:"HKD",pageSize:20}));expect(lines.value[0].unitSellingPrice).toBe("3.3333");});
 it("shows a zero-price warning and a lookup failure with retry",async()=>{editor([{...line,unitSellingPrice:"0.0000"}]);expect(wrapper.text()).toContain("零售價");sales.lookupSkus.mockRejectedValueOnce(new Error("暫時無法搜尋")).mockResolvedValueOnce({items:[]});await wrapper.findAll(".q-field").find(q=>q.text().includes("條碼")).find("input").setValue("missing");const search=wrapper.findAll("button").find(b=>b.text()==="搜尋條碼");await search.trigger("click");await flushPromises();expect(wrapper.find('[role="alert"]').text()).toContain("暫時無法搜尋");await search.trigger("click");await flushPromises();expect(wrapper.find('[role="alert"]').exists()).toBe(false);expect(wrapper.findAll("button").find(b=>b.text()==="新增明細").element.disabled).toBe(true);});
 it("rounds each line with exact decimals and reports invalid preview as unavailable",async()=>{wrapper=mount(Summary,{props:{lines:[{quantity:"0.000001",unitSellingPrice:"50.0000"},{quantity:"2.000000",unitSellingPrice:"3.3333"}],currencyCode:"HKD",savedTotal:"6.6666"}});expect(wrapper.find('[role="status"]').text()).toContain("6.6667");expect(wrapper.text()).toContain("以儲存後伺服器總額為準");await wrapper.setProps({lines:[{quantity:"0",unitSellingPrice:"3.3333"}]});expect(wrapper.text()).toContain("預計總額 —");});
});
