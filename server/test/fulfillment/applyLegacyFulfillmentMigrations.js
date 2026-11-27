import { readdir } from "node:fs/promises";

const directory = new URL("../../database/migrations/", import.meta.url);

export async function applyLegacyFulfillmentMigrations(db, alreadyApplied = []) {
  const names = (await readdir(directory)).filter(name => /^[0-9]{4}_.*\.js$/u.test(name)).sort();
  for (const name of names) {
    const version = Number(name.slice(0, 4));
    // These quantity-only fixtures seed stock directly, before cost enablement.
    if (version <= 88 || name === "0130_create_inventory_cost.js" || alreadyApplied.includes(version)) continue;
    await (await import(new URL(name, directory).href)).up(db);
  }
}
