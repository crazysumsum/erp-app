#!/bin/bash
# T51 rehearsal: previous release -> current main, on a throwaway MySQL (socket /tmp/m50.sock, port 3450, admin root).
# Usage: SCRATCH=<dir> OLD_WORKTREE=<checkout of the previous release, npm ci done> NEW_WORKTREE=<checkout of current main> bash rehearsal.sh
# Never point it at a real database: it creates and drops erp_t51_rh_old and erp_t51_rh_restore.
set -u
OLD=$OLD_WORKTREE/server
NEW=$NEW_WORKTREE/server
OUT=$SCRATCH/t51
mkdir -p "$OUT"
DB=erp_t51_rh_old
RESTORE=erp_t51_rh_restore
MYSQL="/usr/local/mysql/bin/mysql -uroot -proot -S /tmp/m50.sock --default-character-set=utf8mb4"
export DB_HOST=127.0.0.1 DB_PORT=3450 DB_USER=root DB_PASSWORD=root DB_SOCKET_PATH= DB_SSL_ENABLED=false APP_HOST=127.0.0.1
export JWT_SECRET=bench-jwt-secret-0123456789abcdef0123456789abcdef
for owner in SUPPLIER CUSTOMER; do
  export ${owner}_BANK_ACTIVE_KEY_ID=enc-1 ${owner}_BANK_ENCRYPTION_KEYS='{"enc-1":"R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg="}'
  export ${owner}_BANK_LOOKUP_ACTIVE_KEY_ID=look-1 ${owner}_BANK_LOOKUP_KEYS='{"look-1":"THGVVay+dFBH7xi7a8a/BPGP/g16GnMI4Tu85N1AMMw="}'
done
step() { echo; echo "=== $1"; }
checksums() { $MYSQL -N -e "SELECT GROUP_CONCAT(table_name ORDER BY table_name) FROM information_schema.tables WHERE table_schema='$1'" 2>/dev/null | tr ',' '\n' | while read t; do $MYSQL -N -e "CHECKSUM TABLE \`$1\`.\`$t\`" 2>/dev/null | awk '{print $1" "$2}' | sed "s/^$1\.//"; done; }

$MYSQL -e "DROP DATABASE IF EXISTS $DB; DROP DATABASE IF EXISTS $RESTORE; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci" 2>/dev/null

step "1. Previous release 72e205ef: its own runner on an empty database"
(cd $OLD && DB_NAME=$DB node scripts/migrate.js | tail -2)
$MYSQL -N -e "SELECT COUNT(*), MAX(name) FROM $DB.fr_schema_migrations" 2>/dev/null

step "2. Business data under the previous release"
$MYSQL $DB 2>/dev/null <<SQL
INSERT INTO items (name, status, created_at, updated_at) VALUES ('Rehearsal Item', 'active', 1, 1);
INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (LAST_INSERT_ID(), 'RH-SKU-1', 'Rehearsal SKU', 'active', 1, 1, 1);
SET @sku = LAST_INSERT_ID();
INSERT INTO suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code, website, general_phone, general_email, notes, status, created_at, updated_at)
VALUES ('RH-001', 'rh-001', '香港貿易有限公司', '香港貿易有限公司', '', 'HKD', '', '', '', '', 'active', 1, 1),
       ('RH-002', 'rh-002', 'Northwind Paper Company', 'northwind paper company', '', 'HKD', '', '', '', '', 'draft', 1, 1);
INSERT INTO supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
SELECT id, 'business_registration', 'HK', '12345678', '12345678', 1, 1 FROM suppliers WHERE supplier_code_key = 'rh-001';
INSERT INTO supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, @sku, 1, 1 FROM suppliers WHERE supplier_code_key = 'rh-001';
SQL
$MYSQL -N -e "SELECT COUNT(*) FROM $DB.suppliers; SELECT COUNT(*) FROM $DB.supplier_sku_refs" 2>/dev/null | tr '\n' ' '; echo "(suppliers, sku refs)"
echo "DEF-029 on the previous release (an orphan SKU relation is accepted):"
$MYSQL $DB -N -e "START TRANSACTION; INSERT INTO supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, 999999999, 1, 1 FROM suppliers WHERE supplier_code_key='rh-002'; SELECT 'accepted'; ROLLBACK;" 2>&1 | grep -v Warning

step "3. Backup and restore"
/usr/local/mysql/bin/mysqldump -uroot -proot -S /tmp/m50.sock --set-gtid-purged=OFF --hex-blob --single-transaction --routines $DB > $OUT/backup.sql 2>/dev/null; echo "dump exit=$? bytes=$(wc -c < $OUT/backup.sql)"
$MYSQL -e "CREATE DATABASE $RESTORE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci" 2>/dev/null
$MYSQL $RESTORE < $OUT/backup.sql 2>/dev/null; echo "restore exit=$?"
checksums $DB > $OUT/before.txt; checksums $RESTORE > $OUT/restore.txt
diff -q $OUT/before.txt $OUT/restore.txt >/dev/null && echo "restore matches the source: $(wc -l < $OUT/before.txt) tables, equal CHECKSUM TABLE" || echo "RESTORE DIFFERS"

step "4. Upgrade with the current main's runner"
(cd $NEW && DB_NAME=$DB node scripts/migrate.js | grep -v "^skip" )
checksums $DB > $OUT/after.txt
echo "tables whose checksum changed in the upgrade: $(diff $OUT/before.txt $OUT/after.txt | grep '^>' | wc -l | tr -d ' ')"
diff $OUT/before.txt $OUT/after.txt | grep '^[<>]' | head
echo "DEF-029 after the upgrade (the orphan is refused):"
$MYSQL $DB -N -e "START TRANSACTION; INSERT INTO supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, 999999999, 1, 1 FROM suppliers WHERE supplier_code_key='rh-002'; ROLLBACK;" 2>&1 | grep -v Warning | sed 's/^/  /'

serve() { # $1 dir, $2 label
  local port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  local log=$OUT/server-$2.log
  (cd $(mktemp -d) && DB_NAME=$DB APP_PORT=$port node $1/src/index.js > $log 2>&1 & echo $! > $OUT/pid-$2)
  for i in $(seq 1 60); do grep -q "API listening" $log && break; sleep 0.5; done
  echo "$2 server: $(grep -c 'API listening' $log) listening; health $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/api/v1/health)"
  kill $(cat $OUT/pid-$2) 2>/dev/null; wait $(cat $OUT/pid-$2) 2>/dev/null
}
step "5. Server: current main, then rolled back to the previous release, on the upgraded schema"
serve $NEW current
serve $OLD previous

step "6. Similar-name exception list (HD-057 A) on a sample legacy file"
(cd $NEW && node --input-type=module -e '
import fs from "node:fs";
import { stringify } from "csv-stringify/sync";
import { SUPPLIER_IMPORT_COLUMN_NAMES } from "./src/modules/supplier/import/supplierCsvSchema.js";
const rows = [["L-001", "香港貿易有限公司"], ["L-002", "Northwind Paper Co"], ["L-003", "Contoso Trading"], ["L-004", "Contoso Trading Ltd"]];
fs.writeFileSync(process.argv[1], stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...rows.map(([code, name]) =>
  SUPPLIER_IMPORT_COLUMN_NAMES.map((column) => ({ supplierCode: code, supplierName: name, defaultCurrencyCode: "HKD" })[column] ?? ""))]));
' $OUT/legacy.csv)
rm -f $OUT/similar.csv
(cd $NEW && DB_NAME=$DB node src/modules/supplier/similarNameReport.js --database $DB --mode create_only --input $OUT/legacy.csv --output $OUT/similar.csv)
cat $OUT/similar.csv

$MYSQL -e "DROP DATABASE IF EXISTS $DB; DROP DATABASE IF EXISTS $RESTORE" 2>/dev/null
echo; echo "=== done; scratch databases dropped"
