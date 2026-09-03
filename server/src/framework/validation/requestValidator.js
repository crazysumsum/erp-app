import Ajv from "ajv";
import addFormats from "ajv-formats";
import requestConfig from "../../../config/request.js";
import { ApplicationError } from "../errors/ApplicationError.js";
import { normalizeRequestValidationConfig } from "./normalizeRequestValidationConfig.js";

const REQUEST_LOCATIONS = ["params", "query", "body", "headers"];

function validationDetail(location, error) {
  let path = error.instancePath || "/";

  if (error.keyword === "required" && error.params?.missingProperty) {
    const prefix = error.instancePath || "";
    path = `${prefix}/${error.params.missingProperty}`;
  }

  return {
    location,
    path,
    keyword: error.keyword,
    message: error.message || "is invalid"
  };
}

export class RequestValidationError extends ApplicationError {
  constructor(details, includeDetailsInResponse) {
    super("Request validation failed", {
      code: "REQUEST_VALIDATION_FAILED",
      statusCode: 400,
      details,
      publicDetails: includeDetailsInResponse ? details : undefined
    });
  }
}

export class RequestValidator {
  constructor({ config = requestConfig.validation.input } = {}) {
    this.config = normalizeRequestValidationConfig(config);
    this.ajv = new Ajv({
      allErrors: this.config.allErrors,
      coerceTypes: this.config.coerceTypes,
      useDefaults: this.config.useDefaults,
      removeAdditional: this.config.removeAdditional,
      strict: true
    });
    addFormats(this.ajv, { mode: "fast" });
    // 純標註 keyword，冇對應驗證行為——單純畀 strict mode 唔好因為 body schema
    // 帶咗 `trim: true` 就當佢係打錯字爆炸。實際 trim 喺 compile() 入面、AJV
    // 驗證之前做（見下面 bodyTrimKeys），唔係靠呢個 keyword 本身。
    this.ajv.addKeyword("trim");
  }

  compile(requestSchema, routeKey) {
    if (
      requestSchema === null ||
      typeof requestSchema !== "object" ||
      Array.isArray(requestSchema)
    ) {
      throw new TypeError(`requestSchema must be an object for ${routeKey}`);
    }

    const unsupportedLocations = Object.keys(requestSchema).filter(
      (location) => !REQUEST_LOCATIONS.includes(location)
    );

    if (unsupportedLocations.length > 0) {
      throw new Error(
        `Unsupported requestSchema location for ${routeKey}: ${unsupportedLocations.join(", ")}`
      );
    }

    const validators = this.config.enabled
      ? Object.entries(requestSchema).map(([location, schema]) => {
          try {
            return [location, this.ajv.compile(schema)];
          } catch (error) {
            throw new Error(
              `Invalid ${location} schema for ${routeKey}: ${error.message}`
            );
          }
        })
      : [];

    // body 欄位帶 `trim: true`（例如 USERNAME_SCHEMA）要喺 pattern 一類驗證
    // 之前就 trim 好——原始輸入含頭尾空白的話，驗證見到嘅已經係 trim 後嘅值，
    // 不然合法值會因為外側空白被 pattern 擋走。淨係做 body：目前冇任何
    // params/query/headers 欄位需要呢個行為。
    const bodyTrimKeys = requestSchema.body?.properties
      ? Object.keys(requestSchema.body.properties).filter(
          (key) => requestSchema.body.properties[key]?.trim === true
        )
      : [];

    return (req) => {
      // Express 5 的 req.query 是每次存取都重新解析的 getter，而且不可寫入。
      // 先把每個位置取出成快照再驗證，coerceTypes/useDefaults 的改寫才會保留下來，
      // 同時避免污染原始 request 物件。req.input 是 handler 唯一的輸入來源。
      const sources = {
        params: req.params,
        query: { ...req.query },
        body: req.body ?? {},
        headers: req.headers
      };

      for (const key of bodyTrimKeys) {
        const value = sources.body[key];
        if (typeof value === "string") {
          sources.body[key] = value.trim();
        }
      }

      const details = [];

      for (const [location, validate] of validators) {
        if (!validate(sources[location])) {
          details.push(
            ...(validate.errors || []).map((error) =>
              validationDetail(location, error)
            )
          );
        }
      }

      if (details.length > 0) {
        throw new RequestValidationError(
          details.slice(0, this.config.maxErrors),
          this.config.includeErrorDetailsInResponse
        );
      }

      req.input = Object.freeze({
        params: requestSchema.params ? sources.params : {},
        query: requestSchema.query ? sources.query : {},
        body: requestSchema.body ? sources.body : null,
        headers: requestSchema.headers ? sources.headers : {}
      });
    };
  }
}
