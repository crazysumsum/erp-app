import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";

import { inspectCustomerAttachmentSchema } from "../../database/migrations/0050_create_customer_attachments.js";
import { inspectCustomerAttachmentStageSchema } from "../../database/migrations/0051_create_customer_attachment_stages.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;

integrationTest("Customer attachment migration enforces operation, object and owner constraints", async (t) => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME
  });
  const suffix = randomUUID().slice(0, 8); const now = Date.now();
  const [user] = await connection.execute(
    "INSERT INTO users (username,password_hash,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    [`attachment-${suffix}`, "unused", "Attachment Test", now, now]
  );
  const userId = Number(user.insertId); const operationId = randomUUID(); let customerId;
  t.after(async () => {
    if (customerId) await connection.execute("DELETE FROM customers WHERE id = ?", [customerId]);
    await connection.execute("DELETE FROM customer_operation_requests WHERE id = ?", [operationId]);
    await connection.execute("DELETE FROM users WHERE id = ?", [userId]);
    await connection.end();
  });

  assert.equal(await inspectCustomerAttachmentSchema(connection), true);
  assert.equal(await inspectCustomerAttachmentStageSchema(connection), true);
  const [customer] = await connection.execute(
    "INSERT INTO customers (customer_code,customer_code_key,legal_name,legal_name_key,created_at,updated_at) VALUES (?,?,?,?,?,?)",
    [`ATT-${suffix}`, `att-${suffix}`, `Attachment ${suffix}`, `attachment ${suffix}`, now, now]
  );
  customerId = Number(customer.insertId);
  await connection.execute(
    "INSERT INTO customer_operation_requests (id,actor_user_id,route_key,idempotency_key,payload_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,'processing',?,?)",
    [operationId, userId, "customer.attachment.upload", `key-${suffix}`, randomBytes(32), now, now]
  );
  await connection.execute(
    "INSERT INTO customer_attachment_stages (operation_id,stored_name,created_at,updated_at) VALUES (?,?,?,?)",
    [operationId, "b".repeat(64), now, now]
  );
  await connection.execute("DELETE FROM customer_attachment_stages WHERE operation_id = ?", [operationId]);
  const insert = (operation = operationId, name = "a".repeat(64)) => connection.execute(
    `INSERT INTO customer_attachments
       (customer_id,display_name,document_type,sensitivity,original_filename,operation_id,stored_name,mime_type,
        extension,size_bytes,sha256,storage_class,scan_status,status,created_at,updated_at,created_by,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'processing',?,?,?,?)`,
    [customerId, "Contract", "contract", "general", "contract.pdf", operation, name, "application/pdf",
      "pdf", 8, randomBytes(32), "general_private", "clean", now, now, userId, userId]
  );
  await insert();
  await assert.rejects(() => insert(), (error) => error.code === "ER_DUP_ENTRY");
  await connection.execute("DELETE FROM customers WHERE id = ?", [customerId]); customerId = null;
  const [[remaining]] = await connection.query("SELECT COUNT(*) AS count FROM customer_attachments WHERE operation_id = ?", [operationId]);
  assert.equal(Number(remaining.count), 0);
});
