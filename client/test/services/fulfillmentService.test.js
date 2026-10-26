import { beforeEach,describe,it,expect,vi } from "vitest";
vi.mock("@/framework/http/HttpClient.js",()=>({httpClient:{get:vi.fn(),post:vi.fn()}}));
import { httpClient } from "@/framework/http/HttpClient.js";
import fulfillment,{service,normalizeFulfillmentQuery} from "@/services/fulfillment.js";
describe("TASK020 Fulfillment client contract",()=>{
 beforeEach(()=>vi.clearAllMocks());
 it("preserves keyset pages and server quantities/actions without inventing totals",async()=>{
  expect(service.name).toBe("fulfillment");const page={items:[{id:"8",fulfillableBaseQuantity:"9007199254740991"}],page:2,pageSize:20,hasMore:true,nextCursor:"next"},signal=new AbortController().signal;httpClient.get.mockResolvedValue(page);
  await expect(fulfillment.listQueue({page:"2",rowsPerPage:"20",filter:" SO-1 ",cursor:"opaque",hasActiveWork:"false",salesOrderStatus:"CONFIRMED",signal})).resolves.toBe(page);expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/fulfillment-queue",{params:{page:2,pageSize:20,q:"SO-1",cursor:"opaque",hasActiveWork:false,salesOrderStatus:"CONFIRMED"},signal});
  await expect(fulfillment.listFulfillments({view:"myRecent",status:"PICKED",hasShortPick:false,createdFrom:0,sortBy:"lastBusinessUpdatedAt",descending:true})).resolves.toBe(page);expect(httpClient.get.mock.lastCall[1].params).toEqual({view:"myRecent",status:"PICKED",hasShortPick:false,createdFrom:0,sortBy:"lastBusinessUpdatedAt",descending:true});
 });
 it("normalizes URL scalar filters and refuses unknown filters/status/sort and unbound pages before HTTP",()=>{
  const input={warehouseId:"7",hasBackorder:"false",descending:"true",page:"1",pageSize:"100",requestedDateFrom:"2026-10-01"};const result=normalizeFulfillmentQuery("queue",input);expect(result).toEqual({...input,warehouseId:7,hasBackorder:false,descending:true,page:1,pageSize:100});expect(normalizeFulfillmentQuery("queue",Object.fromEntries(new URLSearchParams(result)))).toEqual(result);expect(input.page).toBe("1");
  for(const [kind,query]of [["queue",{salesOrderStatus:"DRAFT"}],["list",{status:"bogus"}],["list",{sortBy:"sql"}],["list",{status:["DRAFT"]}],["queue",{page:2}],["list",{pageSize:101}],["queue",{hasBackorder:"no"}],["list",{actorId:7}],["list",{createdFrom:-1}],["queue",{warehouseId:"1.5"}]])expect(()=>normalizeFulfillmentQuery(kind,query)).toThrow();expect(httpClient.get).not.toHaveBeenCalled();
 });
 it("forwards detail child pages, candidate versions and planned Pick List projection",async()=>{
  const data={fulfillment:{allowedActions:[],lines:[]}},signal=new AbortController().signal;httpClient.get.mockResolvedValue(data);
  await expect(fulfillment.getFulfillment("8",{allocationAfterId:"100",historyBeforeSequence:8,signal})).resolves.toBe(data);expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/fulfillments/8",{params:{allocationAfterId:"100",historyBeforeSequence:8},signal});
  await fulfillment.getCandidates("8",{version:3,page:2,signal});expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/fulfillments/8/allocation-candidates",{params:{version:3,page:2},signal});await fulfillment.getPickList("8",{signal});expect(httpClient.get).toHaveBeenLastCalledWith("/api/v1/fulfillments/8/pick-list",{signal});
 });
 it("retains immutable event/version/quantity strings and transport identity on every command",async()=>{
  const body=Object.freeze({eventId:"original",version:3,lines:Object.freeze([{pickedBaseQuantity:"9007199254740991"}])}),signal=new AbortController().signal,response={outcome:{id:"8",version:4},fulfillment:{version:5,allowedActions:["cancel"]}};httpClient.post.mockResolvedValue(response);
  for(const [method,path]of [["updateFulfillment","update"],["allocate","allocate"],["reallocate","reallocate"],["confirmPick","pick-confirm"],["cancel","cancel"]]){await expect(fulfillment[method]("8",body,{signal})).resolves.toBe(response);expect(httpClient.post).toHaveBeenLastCalledWith(`/api/v1/fulfillments/8/${path}`,{idempotent:true,idempotencyKey:"original",body,signal});}
  await fulfillment.createFulfillment({...body,idempotencyKey:"transport"});expect(httpClient.post).toHaveBeenLastCalledWith("/api/v1/fulfillments/create",{idempotent:true,idempotencyKey:"transport",body});
 });
 it("preserves pending202 data and rejected409/503 intent for caller recovery without retrying",async()=>{
  const pending={status:"IN_PROGRESS",statusUrl:"/api/v1/fulfillment-operations/by-event/original",retryAfterSeconds:2};httpClient.post.mockResolvedValue(pending);await expect(fulfillment.cancel(8,{eventId:"original",version:1})).resolves.toBe(pending);
  for(const code of ["VERSION_CONFLICT","ALLOCATION_CANDIDATE_CHANGED","DATABASE_TRANSACTION_INDETERMINATE"]){const error=Object.assign(new Error("safe"),{code});httpClient.post.mockRejectedValueOnce(error);await expect(fulfillment.cancel(8,{eventId:"original",version:1})).rejects.toBe(error);}expect(httpClient.post).toHaveBeenCalledTimes(4);
 });
});
