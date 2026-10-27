import fs from "node:fs";
import { connect, fixturePath, importRoot, isScratchName, readFixture } from "./uatEnvironment.mjs";

/** 刪 uatServer 開嘅 scratch database。名唔係 `${DB_NAME}_rh_uat…` 就唔郁。 */
export default async function globalTeardown() {
  if (!fs.existsSync(fixturePath)) return;
  const { database } = readFixture();
  if (!isScratchName(database)) throw new Error(`refusing to drop ${database}: not a Supplier UAT scratch database`);
  const admin = await connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await admin.end();
  }
  fs.rmSync(fixturePath, { force: true });
  fs.rmSync(importRoot, { recursive: true, force: true });
}
