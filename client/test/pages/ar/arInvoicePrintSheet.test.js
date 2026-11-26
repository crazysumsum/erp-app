import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import InvoicePrintSheet from "@/components/ar/ArInvoicePrintSheet.vue";

it("列印版顯示帳單地址、來源單號、銷售單位、快照單價及伺服器總額", () => {
  const wrapper = mount(InvoicePrintSheet, { props: {
    issuerName: "Example Trading",
    issuerHeader: "10 Example Street\nHong Kong\ninvoice-qa@example.invalid",
    paymentInstructions: "Example payment instructions",
    footer: "Example invoice footer",
    invoice: {
      number: "INV-2026-000042", invoiceDate: "2026-11-20", dueDate: "2026-12-20", paymentTermCode: "NET30", paymentTermName: "30 天",
      customerName: "Example Customer", currencyCode: "HKD", currencyDecimalPlaces: 2,
      billingAddress: ["42 Bill Road", "Hong Kong"], totalAmount: "150.0200",
      lines: [{ id: 42, lineNo: 1, skuCode: "SKU-042", skuName: "Example Item", quantity: "24", salesUomCode: "BOX", baseUomCode: "EA",
        toBaseFactor: 12, unitPrice: "75.0050", lineAmount: "150.0101", salesOrderNumber: "SO-42", shipmentNumber: "SHP-42" }]
    }
  } });
  expect(wrapper.get("h2").text()).toContain("INV-2026-000042");
  expect(wrapper.get("header").text()).toContain("10 Example Street\nHong Kong");
  expect(wrapper.get("header").text()).toContain("invoice-qa@example.invalid");
  expect(wrapper.get("address").text()).toContain("42 Bill Road");
  expect(wrapper.get("tbody tr").text()).toContain("SO-42");
  expect(wrapper.get("tbody tr").text()).toContain("SHP-42");
  expect(wrapper.get("tbody tr").text()).toContain("2 BOX × 75.0050");
  expect(wrapper.get("tbody tr").text()).toContain("150.0101");
  expect(wrapper.findAll("tfoot tr").map((row) => row.text())).toEqual(["小計HKD 150.02", "總額HKD 150.02"]);
  expect(wrapper.get("section").text()).toContain("Example payment instructions");
  expect(wrapper.get("footer").text()).toBe("Example invoice footer");
});
