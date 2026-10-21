/* global process, console */
// T51 rehearsal helper: read the rehearsal's Supplier rows through one release's own app and HTTP stack.
// Usage (from that release's server/ directory, DB_* and DB_NAME set): node read_through.mjs <that release's supplierHttpHarness.js>
// It creates one user with an approved device (removed again by the harness) and only reads Supplier data.
import { pathToFileURL } from "node:url";

const { createSupplierHarness } = await import(pathToFileURL(process.argv[2]).href);
const h = createSupplierHarness("t51rh");
let failure = null;
try {
  await h.start();
  const user = await h.makeUser("reader", ["supplier.view"]);
  const list = await h.send(user, h.route("GET /api/v1/suppliers"));
  const found = (list.json?.data?.items ?? list.json?.data ?? []).find((row) => row.supplierCode === "RH-001");
  if (list.status !== 200 || !found) throw new Error(`list ${list.status}: RH-001 not listed`);
  const detail = await h.send(user, h.route("GET /api/v1/suppliers/:id"), { ids: { id: found.id } });
  if (detail.status !== 200 || detail.json.data.supplierName !== "香港貿易有限公司") throw new Error(`detail ${detail.status}`);
  const relations = await h.send(user, h.route("GET /api/v1/suppliers/:id/sku-relations"), { ids: { id: found.id } });
  const rows = relations.json?.data?.items ?? relations.json?.data ?? [];
  if (relations.status !== 200 || rows.length !== 1) throw new Error(`sku-relations ${relations.status}: ${rows.length} rows`);
  console.log(`list 200 (RH-001 listed), detail 200 (${detail.json.data.supplierName}), sku-relations 200 (${rows.length} row)`);
} catch (error) {
  failure = error;
} finally {
  await h.stop();
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
