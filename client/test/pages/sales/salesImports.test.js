import {expect,it} from "vitest";
import {page as list} from "@/pages/sales/SalesImportsPage.vue";
import {page as create} from "@/pages/sales/SalesImportCreatePage.vue";
import {page as detail} from "@/pages/sales/SalesImportDetailPage.vue";
import {page as exceptions} from "@/pages/sales/SalesImportExceptionsPage.vue";
it("TC-043 import navigation allows view results and requires both permissions for upload",()=>{expect(list.path).toBe("/sales/imports");expect(exceptions.path).toBe("/sales/imports/exceptions");expect(detail.path).toBe("/sales/imports/:id");for(const page of [list,detail,exceptions])expect(page.requires.permissions).toEqual(["sales.view"]);expect(create.requires.permissions).toEqual(["sales.view","sales.import"]);});
