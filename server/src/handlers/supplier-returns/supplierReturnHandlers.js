import { CommandHandler, EMPTY, ID, InquiryHandler, SUMMARY, TEXT, detail, list, source, write } from "../../modules/returns/returnHandlerSupport.js";

const SUPPLIER = "/api/v1/supplier-returns";
const SUPPLIER_WRITE = { name: "hasPermission", options: { permissions: ["returns.supplier.mgmt"] } };
const SUPPLIER_SUMMARY = { ...SUMMARY, goodsReceiptId: ID, goodsReceiptNumber: TEXT };

export class ListSupplierReturnsHandler extends InquiryHandler {
  static handlerName = "listSupplierReturns";
  static api = list(SUPPLIER, SUPPLIER_SUMMARY);
  static kind = "supplier";
  static action = "list";
}
export class GetSupplierReturnHandler extends InquiryHandler {
  static handlerName = "getSupplierReturn";
  static api = detail(SUPPLIER, SUPPLIER_SUMMARY);
  static kind = "supplier";
  static action = "detail";
}
export class GetSupplierReturnSourceHandler extends InquiryHandler {
  static handlerName = "getSupplierReturnSource";
  static api = source(SUPPLIER);
  static kind = "supplier";
  static action = "source";
}
export class CreateSupplierReturnHandler extends CommandHandler {
  static handlerName = "createSupplierReturn";
  static api = write(SUPPLIER, SUPPLIER_WRITE, "Create a supplier return draft", EMPTY);
  static kind = "supplier";
  static action = "create";
}
export class CancelSupplierReturnHandler extends CommandHandler {
  static handlerName = "cancelSupplierReturn";
  static api = write(`${SUPPLIER}/:id/cancel`, SUPPLIER_WRITE, "Cancel a supplier return draft");
  static kind = "supplier";
  static action = "cancel";
}

export class PostSupplierReturnHandler extends CommandHandler {
  static handlerName = "postSupplierReturn";
  static api = write(`${SUPPLIER}/:id/post`, SUPPLIER_WRITE, "Post a supplier return issue");
  static kind = "supplier";
  static action = "post";
}
