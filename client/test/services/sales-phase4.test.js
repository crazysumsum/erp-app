import {beforeEach,expect,it,vi} from "vitest";
vi.mock("@/framework/http/HttpClient.js",()=>({httpClient:{get:vi.fn()}}));
import {httpClient} from "@/framework/http/HttpClient.js";
import sales from "@/services/sales.js";
beforeEach(()=>{vi.clearAllMocks();httpClient.get.mockResolvedValue({items:[{id:1,quantities:{outstandingBaseQuantity:"9007199254740992"}}],total:21});});
it("TC-044 Outstanding preserves exact quantities, filters, page and cancellation",async()=>{const signal=new AbortController().signal;await expect(sales.listOutstanding({page:2,rowsPerPage:20,filter:"C1",hasBackorder:true,signal})).resolves.toEqual({rows:[{id:1,quantities:{outstandingBaseQuantity:"9007199254740992"}}],rowsNumber:21});expect(httpClient.get).toHaveBeenCalledWith("/api/v1/outstanding-sales-orders",{params:{page:2,pageSize:20,q:"C1",hasBackorder:true},signal});});
it("TC-046 Audit drops DataTable search and forwards only requested target/page fields",async()=>{await sales.listAudit({targetType:"ORDER",targetId:8,page:3,rowsPerPage:20,filter:"",sortBy:"occurredAt",descending:true,signal:"abort"});expect(httpClient.get).toHaveBeenCalledWith("/api/v1/sales-audit-logs",{params:{targetType:"ORDER",targetId:8,page:3,pageSize:20,sortBy:"occurredAt",descending:true},signal:"abort"});});
