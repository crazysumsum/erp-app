import { ATTRIBUTE_DATA_TYPES } from "../../modules/item/itemConstants.js";

const ATTRIBUTE_OPTION_PROJECTION_SCHEMA = Object.freeze({
  anyOf: [
    {
      type: "object",
      required: ["id", "value", "label"],
      additionalProperties: false,
      properties: {
        id: { type: "integer", minimum: 1 },
        value: { type: "string" },
        label: { type: "string" }
      }
    },
    { type: "null" }
  ]
});

export const ATTRIBUTE_VALUE_PROJECTION_SCHEMA = Object.freeze({
  type: "object",
  required: ["attributeId", "code", "name", "dataType", "value", "option"],
  additionalProperties: false,
  properties: {
    attributeId: { type: "integer", minimum: 1 },
    code: { type: "string" },
    name: { type: "string" },
    dataType: { type: "string", enum: [...ATTRIBUTE_DATA_TYPES] },
    value: {},
    option: ATTRIBUTE_OPTION_PROJECTION_SCHEMA
  },
  oneOf: [
    {
      properties: {
        dataType: { enum: ["text", "long_text", "decimal"] },
        value: { type: "string" },
        option: { type: "null" }
      }
    },
    {
      properties: {
        dataType: { const: "boolean" },
        value: { type: "boolean" },
        option: { type: "null" }
      }
    },
    {
      properties: {
        dataType: { const: "date" },
        value: { type: "integer" },
        option: { type: "null" }
      }
    },
    {
      properties: {
        dataType: { const: "single_option" },
        value: { type: "string" },
        option: {
          type: "object",
          required: ["id", "value", "label"],
          additionalProperties: false,
          properties: {
            id: { type: "integer", minimum: 1 },
            value: { type: "string" },
            label: { type: "string" }
          }
        }
      }
    }
  ]
});

export const VARIANT_VALUE_PROJECTION_SCHEMA = Object.freeze({
  type: "object",
  required: ["attributeId", "code", "name", "dataType", "value", "option"],
  additionalProperties: false,
  properties: {
    attributeId: { type: "integer", minimum: 1 },
    code: { type: "string" },
    name: { type: "string" },
    dataType: { const: "single_option" },
    value: { type: "string" },
    option: {
      type: "object",
      required: ["id", "value", "label"],
      additionalProperties: false,
      properties: {
        id: { type: "integer", minimum: 1 },
        value: { type: "string" },
        label: { type: "string" }
      }
    }
  }
});
