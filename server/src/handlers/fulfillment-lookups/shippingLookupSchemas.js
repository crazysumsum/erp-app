const object=properties=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const id={type:"integer",minimum:1,maximum:Number.MAX_SAFE_INTEGER},wireId={type:"string",pattern:"^[1-9][0-9]{0,15}$",maxLength:16},version={type:"integer",minimum:1,maximum:4294967295},text={type:"string"};
export const SHIPPING_LOOKUP_PARAMS=object({customerId:id});
export const SHIPPING_LOOKUP_QUERY=object({fulfillmentId:id});
export const SHIPPING_LOOKUP_EMPTY=object({});
export const SHIPPING_ADDRESS_RESPONSE=object({items:{type:"array",items:object({...Object.fromEntries(["label","recipientCompanyDepartment","addressLine1","addressLine2","addressLine3","city","stateRegion","postalCode","countryCode","phone"].map(key=>[key,text])),countryCode:{type:["string","null"],maxLength:2},addressId:wireId,version,isDefault:{type:"boolean"}})}});
export const SHIPPING_CONTACT_RESPONSE=object({items:{type:"array",items:object({...Object.fromEntries(["name","email","phone","mobile"].map(key=>[key,text])),contactId:wireId,version,isDefault:{type:"boolean"}})}});
