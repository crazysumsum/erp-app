import { ArCommandRunner, nextDocumentNumber as nextArDocumentNumber } from "../ar/arCommand.js";
import { lockArCreditNote, updateArCreditNote } from "../ar/arCreditNoteBalance.js";
import { ApCommandRunner, nextDocumentNumber as nextApDocumentNumber } from "../accounts-payable/apCommand.js";
import { lockCreditNote } from "../accounts-payable/apCreditFunds.js";
import { BusinessMasterProvider } from "../businessMaster/BusinessMasterProvider.js";
import { BusinessMasterRepository } from "../businessMaster/BusinessMasterRepository.js";
import { RefundService } from "./RefundService.js";

function businessMaster(database) {
  return new BusinessMasterProvider({ database, repository: new BusinessMasterRepository() });
}

export function customerRefundService({ database, time }) {
  return new RefundService({
    kind: "customer", time, commands: new ArCommandRunner({ database, time }), businessMaster: businessMaster(database),
    nextDocumentNumber: nextArDocumentNumber, lockCreditNote: lockArCreditNote, updateCreditNote: updateArCreditNote
  });
}

export function supplierRefundService({ database, time }) {
  return new RefundService({
    kind: "supplier", time, commands: new ApCommandRunner({ database, time }), businessMaster: businessMaster(database),
    nextDocumentNumber: nextApDocumentNumber, lockCreditNote
  });
}
