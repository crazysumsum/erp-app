import { ApplicationError } from "../../framework/errors/ApplicationError.js";

function businessError(message, { code, statusCode = 400, publicMessage, details } = {}) {
  return new ApplicationError(message, {
    code,
    statusCode,
    publicCode: code,
    publicMessage,
    details,
    publicDetails: details
  });
}

export function invalidBusinessMasterInput(code, publicMessage, details) {
  return businessError(publicMessage, { code, publicMessage, details });
}

export function businessMasterNotFound(entityType, entityKey) {
  return businessError(`${entityType} ${entityKey} was not found`, {
    code: `${entityType.toUpperCase()}_NOT_FOUND`,
    statusCode: 404,
    publicMessage: "找不到指定的資料"
  });
}

export function businessMasterConflict(code, publicMessage, details) {
  return businessError(publicMessage, { code, statusCode: 409, publicMessage, details });
}

export function businessMasterUnavailable(code, publicMessage, details) {
  return businessError(publicMessage, { code, statusCode: 503, publicMessage, details });
}
