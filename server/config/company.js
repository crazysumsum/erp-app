// For multi-line values, configure actual line breaks in the environment value,
// not the two characters backslash and n. Leave unset in non-printing environments.
const companyConfig = {
  name: process.env.AR_INVOICE_COMPANY_NAME,
  header: process.env.AR_INVOICE_COMPANY_HEADER,
  paymentInstructions: process.env.AR_INVOICE_PAYMENT_INSTRUCTIONS,
  footer: process.env.AR_INVOICE_FOOTER
};

export default companyConfig;
