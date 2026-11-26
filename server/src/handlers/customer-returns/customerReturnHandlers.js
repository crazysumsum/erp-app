import { CommandHandler, EMPTY, ID, InquiryHandler, SUMMARY, TEXT, detail, list, source, write } from "../../modules/returns/returnHandlerSupport.js";

const CUSTOMER = "/api/v1/customer-returns";
const CUSTOMER_WRITE = { name: "hasPermission", options: { permissions: ["returns.customer.mgmt"] } };
const CUSTOMER_SUMMARY = { ...SUMMARY, shipmentId: ID, shipmentNumber: TEXT };

export class ListCustomerReturnsHandler extends InquiryHandler {
  static handlerName = "listCustomerReturns";
  static api = list(CUSTOMER, CUSTOMER_SUMMARY, { salesOrderId: ID });
  static kind = "customer";
  static action = "list";
}
export class GetCustomerReturnHandler extends InquiryHandler {
  static handlerName = "getCustomerReturn";
  static api = detail(CUSTOMER, CUSTOMER_SUMMARY);
  static kind = "customer";
  static action = "detail";
}
export class GetCustomerReturnSourceHandler extends InquiryHandler {
  static handlerName = "getCustomerReturnSource";
  static api = source(CUSTOMER);
  static kind = "customer";
  static action = "source";
}
export class CreateCustomerReturnHandler extends CommandHandler {
  static handlerName = "createCustomerReturn";
  static api = write(CUSTOMER, CUSTOMER_WRITE, "Create a customer return draft", EMPTY);
  static kind = "customer";
  static action = "create";
}
export class PostCustomerReturnHandler extends CommandHandler {
  static handlerName = "postCustomerReturn";
  static api = write(`${CUSTOMER}/:id/post`, CUSTOMER_WRITE, "Receive a customer return into quarantine");
  static kind = "customer";
  static action = "post";
}
export class CancelCustomerReturnHandler extends CommandHandler {
  static handlerName = "cancelCustomerReturn";
  static api = write(`${CUSTOMER}/:id/cancel`, CUSTOMER_WRITE, "Cancel a customer return draft");
  static kind = "customer";
  static action = "cancel";
}
