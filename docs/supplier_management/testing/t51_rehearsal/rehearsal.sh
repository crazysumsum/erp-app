#!/bin/bash
# T51 rehearsal on a THROWAWAY MySQL: two upgrade paths, backup/restore, server rollback and the similar-name list.
#
#   PRE_WORKTREE  checkout of main before Supplier existed (b3e5aa90^1), npm ci done
#   OLD_WORKTREE  checkout of the previous release (72e205ef), npm ci done
#   NEW_WORKTREE  checkout of the current release
#   SCRATCH       directory for the output
#   REHEARSAL_SOCKET, REHEARSAL_PORT, REHEARSAL_USER, REHEARSAL_PASSWORD  the throwaway instance (no defaults)
#
# It refuses to run unless the server on the socket reports REHEARSAL_PORT, it only creates and drops databases named
# erp_t51_rh_*, and it exits non-zero on the first failed check (REV-105 H-1, L-2).
set -euo pipefail
: "${PRE_WORKTREE:?}" "${OLD_WORKTREE:?}" "${NEW_WORKTREE:?}" "${SCRATCH:?}"
: "${REHEARSAL_SOCKET:?}" "${REHEARSAL_PORT:?}" "${REHEARSAL_USER:?}" "${REHEARSAL_PASSWORD:?}"
HERE=$(cd "$(dirname "$0")" && pwd)
PRE=$PRE_WORKTREE/server OLD=$OLD_WORKTREE/server NEW=$NEW_WORKTREE/server OUT=$SCRATCH/t51
mkdir -p "$OUT"
export MYSQL_PWD=$REHEARSAL_PASSWORD   # not on the command line, so not visible in ps
MYSQL=(/usr/local/mysql/bin/mysql -u"$REHEARSAL_USER" -S "$REHEARSAL_SOCKET" --default-character-set=utf8mb4 -N -B)
q() { "${MYSQL[@]}" -e "$1"; }
[ "$(q 'SELECT @@port')" = "$REHEARSAL_PORT" ] || { echo "refusing: the server on $REHEARSAL_SOCKET is not the throwaway instance on $REHEARSAL_PORT"; exit 2; }

export DB_HOST=127.0.0.1 DB_PORT=$REHEARSAL_PORT DB_USER=$REHEARSAL_USER DB_PASSWORD=$REHEARSAL_PASSWORD DB_SOCKET_PATH= DB_SSL_ENABLED=false
export APP_HOST=127.0.0.1 JWT_SECRET=rehearsal-jwt-secret-0123456789abcdef0123456789abcdef
for owner in SUPPLIER CUSTOMER; do
  export ${owner}_BANK_ACTIVE_KEY_ID=enc-1 ${owner}_BANK_ENCRYPTION_KEYS='{"enc-1":"R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg="}'
  export ${owner}_BANK_LOOKUP_ACTIVE_KEY_ID=look-1 ${owner}_BANK_LOOKUP_KEYS='{"look-1":"THGVVay+dFBH7xi7a8a/BPGP/g16GnMI4Tu85N1AMMw="}'
done

step() { echo; echo "=== $1"; }
fail() { echo "FAILED: $1"; exit 1; }
fresh() { q "DROP DATABASE IF EXISTS \`$1\`; CREATE DATABASE \`$1\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"; }
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  for db in erp_t51_rh_pre erp_t51_rh_old erp_t51_rh_restore; do q "DROP DATABASE IF EXISTS \`$db\`" || true; done
}
trap cleanup EXIT

# Everything a restore or an upgrade could change, one line per object: the data of every table (CHECKSUM TABLE, one
# table per query; a NULL checksum fails), AUTO_INCREMENT, columns, indexes, foreign keys, triggers, routines, views
# and events.
fingerprint() {
  local db=$1 t sum count=0
  while read -r t; do
    [ -z "$t" ] && continue
    sum=$(q "CHECKSUM TABLE \`$db\`.\`$t\`" | cut -f2)
    { [ -n "$sum" ] && [ "$sum" != NULL ]; } || fail "no checksum for $db.$t"
    echo "data $t $sum"; count=$((count + 1))
  done < <(q "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY table_name")
  [ "$count" = "$(q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE'")" ] || fail "table count mismatch in $db"
  q "SELECT CONCAT_WS(' ', 'auto', table_name, IFNULL(auto_increment,'-')) FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY table_name"
  q "SELECT CONCAT_WS(' ', 'column', table_name, column_name, ordinal_position, column_type, is_nullable, IFNULL(column_default,'NULL'), IFNULL(collation_name,'-'), extra) FROM information_schema.columns WHERE table_schema='$db' ORDER BY table_name, ordinal_position"
  q "SELECT CONCAT_WS(' ', 'index', table_name, index_name, non_unique, seq_in_index, column_name) FROM information_schema.statistics WHERE table_schema='$db' ORDER BY table_name, index_name, seq_in_index"
  q "SELECT CONCAT_WS(' ', 'fk', table_name, constraint_name, referenced_table_name, update_rule, delete_rule) FROM information_schema.referential_constraints WHERE constraint_schema='$db' ORDER BY table_name, constraint_name"
  q "USE \`$db\`; SELECT CONCAT_WS(' ', 'trigger', event_object_table, trigger_name, action_timing, event_manipulation, SHA2(action_statement, 256)) FROM information_schema.triggers WHERE trigger_schema='$db' ORDER BY trigger_name"
  q "USE \`$db\`; SELECT CONCAT_WS(' ', 'routine', routine_name, routine_type, SHA2(routine_definition, 256)) FROM information_schema.routines WHERE routine_schema='$db' ORDER BY routine_name"
  q "USE \`$db\`; SELECT CONCAT_WS(' ', 'view', table_name, SHA2(view_definition, 256)) FROM information_schema.views WHERE table_schema='$db' ORDER BY table_name"
  q "USE \`$db\`; SELECT CONCAT_WS(' ', 'event', event_name, SHA2(event_definition, 256)) FROM information_schema.events WHERE event_schema='$db' ORDER BY event_name"
  echo "tables $count"
}

# A server process: `exec`, so $! is node itself; the port must be closed after the kill (REV-105 H-2).
serve() { # $1 server dir, $2 label, $3 database
  local port log pid health
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log=$OUT/server-$2.log
  ( cd "$(mktemp -d)" && DB_NAME=$3 APP_PORT=$port exec node "$1/src/index.js" ) > "$log" 2>&1 &
  pid=$!; PIDS+=("$pid")
  for _ in $(seq 1 60); do grep -q "API listening" "$log" && break; sleep 0.5; done
  grep -q "API listening" "$log" || fail "$2 server did not start: $(tail -3 "$log")"
  health=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/health")
  kill "$pid"; wait "$pid" 2>/dev/null || true
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:$port/api/v1/health"; then fail "$2 server still answers after it was stopped"; fi
  [ "$health" = 200 ] || fail "$2 server health $health"
  echo "$2 server: started, health 200, stopped (port closed)"
}

# The Supplier rows from step B read through a release's own app and HTTP stack, with a real user and device (its test
# harness), so a rolled-back server is shown to read the new schema, not only to start (REV-105 M-3).
read_through() { # $1 server dir, $2 label, $3 database
  echo -n "$2 reads the Supplier rows over HTTP: "
  ( cd "$1" && DB_NAME=$3 DB_INTEGRATION_TESTS=1 node "$HERE/read_through.mjs" "$1/test/integration/supplierHttpHarness.js" ) \
    || fail "$2 could not read the Supplier rows"
}

step "A. Adding Supplier to a deployment without it: pre-Supplier main (b3e5aa90^1) -> current release, real runners"
fresh erp_t51_rh_pre
(cd "$PRE" && DB_NAME=erp_t51_rh_pre node scripts/migrate.js | tail -1)
echo "pre-Supplier ledger: $(q "SELECT COUNT(*) FROM erp_t51_rh_pre.fr_schema_migrations") files"
q "INSERT INTO erp_t51_rh_pre.users (username, password_hash, created_at, updated_at) VALUES ('rehearsal-operator', 'not-a-real-hash', 11, 12);
   INSERT INTO erp_t51_rh_pre.user_audit_logs (action, actor_username, occurred_at, target_label, target_type) VALUES ('user.create', 'rehearsal-operator', 13, 'rehearsal-operator', 'user');
   INSERT INTO erp_t51_rh_pre.items (name, status, created_at, updated_at) VALUES ('Pre-Supplier Item', 'active', 14, 15);"
# Permission and grant rows, by value: every row that existed before must still exist unchanged (the tables gain the
# seeds of every later module, Supplier's included).
grant_rows() { q "SELECT CONCAT_WS('|', 'permission', id, name, description, created_at) FROM erp_t51_rh_pre.permissions ORDER BY id;
  SELECT CONCAT_WS('|', 'grant', role_id, permission_id) FROM erp_t51_rh_pre.role_permissions ORDER BY role_id, permission_id"; }
fingerprint erp_t51_rh_pre | awk '!($1 ~ /^(data|auto)$/ && $2 ~ /^(fr_schema_migrations|permissions|role_permissions)$/)' > "$OUT/pre-before.txt"
grant_rows | sort > "$OUT/pre-grants-before.txt"
echo "applied by the current runner, in main's order: $(cd "$NEW" && DB_NAME=erp_t51_rh_pre node scripts/migrate.js | grep -c '^applied') files"
# The real runner applies every later migration of every module (0028-0087), so new objects are expected. What must not
# happen is a change to, or the loss of, anything that existed before: no line of the "before" fingerprint may be missing.
fingerprint erp_t51_rh_pre | awk '!($1 ~ /^(data|auto)$/ && $2 ~ /^(fr_schema_migrations|permissions|role_permissions)$/) && $1 != "tables"' > "$OUT/pre-after.txt"
grep -v '^tables ' "$OUT/pre-before.txt" | diff - "$OUT/pre-after.txt" > "$OUT/pre-diff.txt" || true
if grep -q '^<' "$OUT/pre-diff.txt"; then grep '^<' "$OUT/pre-diff.txt"; fail "an object that existed before the upgrade changed or disappeared"; fi
grant_rows | sort > "$OUT/pre-grants-after.txt"
lost=$(comm -23 "$OUT/pre-grants-before.txt" "$OUT/pre-grants-after.txt")
[ -z "$lost" ] || { echo "$lost"; fail "an existing permission or grant changed or disappeared"; }
echo "every pre-existing table's data, counter, columns, indexes, keys and triggers unchanged ($(grep -c '^data ' "$OUT/pre-before.txt") tables), plus every existing permission and grant"
echo "objects added by the upgrade, all modules: $(grep -c '^>' "$OUT/pre-diff.txt") lines, of which Supplier tables: $(grep '^> data ' "$OUT/pre-diff.txt" | awk '$3 ~ /^supplier/' | wc -l | tr -d ' ')"
echo "Supplier permissions added: $(q "SELECT COUNT(*) FROM erp_t51_rh_pre.permissions WHERE name LIKE 'supplier.%'")"
serve "$NEW" current-on-upgraded-pre erp_t51_rh_pre

step "B. Previous release 72e205ef with business data: backup/restore, upgrade, rollback"
fresh erp_t51_rh_old
(cd "$OLD" && DB_NAME=erp_t51_rh_old node scripts/migrate.js | tail -1)
q "INSERT INTO erp_t51_rh_old.items (name, status, created_at, updated_at) VALUES ('Rehearsal Item', 'active', 1, 1);
   INSERT INTO erp_t51_rh_old.item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (LAST_INSERT_ID(), 'RH-SKU-1', 'Rehearsal SKU', 'active', 1, 1, 1);
   SET @sku = LAST_INSERT_ID();
   INSERT INTO erp_t51_rh_old.suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code, website, general_phone, general_email, notes, status, created_at, updated_at)
   VALUES ('RH-001', 'rh-001', '香港貿易有限公司', '香港貿易有限公司', '', 'HKD', '', '', '', '', 'active', 1, 1),
          ('RH-002', 'rh-002', 'Northwind Paper Company', 'northwind paper company', '', 'HKD', '', '', '', '', 'draft', 1, 1);
   INSERT INTO erp_t51_rh_old.supplier_identifiers (supplier_id, identifier_type, issuer_country_code, identifier_value, identifier_value_key, created_at, updated_at)
   SELECT id, 'business_registration', 'HK', '12345678', '12345678', 1, 1 FROM erp_t51_rh_old.suppliers WHERE supplier_code_key = 'rh-001';
   INSERT INTO erp_t51_rh_old.supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, @sku, 1, 1 FROM erp_t51_rh_old.suppliers WHERE supplier_code_key = 'rh-001';"
orphan() { if q "START TRANSACTION; INSERT INTO erp_t51_rh_old.supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, 999999999, 1, 1 FROM erp_t51_rh_old.suppliers WHERE supplier_code_key='rh-002'; ROLLBACK;" >/dev/null 2>&1; then echo accepted; else echo refused; fi; }
[ "$(orphan)" = accepted ] || fail "control: the previous release should still accept an orphan SKU relation (DEF-029)"
echo "previous release: an orphan SKU relation is accepted (DEF-029, control)"
read_through "$OLD" previous erp_t51_rh_old

/usr/local/mysql/bin/mysqldump -u"$REHEARSAL_USER" -S "$REHEARSAL_SOCKET" --set-gtid-purged=OFF --hex-blob --single-transaction --routines --triggers --events erp_t51_rh_old > "$OUT/backup.sql"
fresh erp_t51_rh_restore
"${MYSQL[@]}" erp_t51_rh_restore < "$OUT/backup.sql"
fingerprint erp_t51_rh_old > "$OUT/old-before.txt"
fingerprint erp_t51_rh_restore > "$OUT/restore.txt"
diff "$OUT/old-before.txt" "$OUT/restore.txt" > "$OUT/restore-diff.txt" || { cat "$OUT/restore-diff.txt"; fail "the restore differs from the source"; }
echo "backup restored exactly: $(tail -1 "$OUT/old-before.txt"); data, counters, columns, indexes, keys, triggers, routines, views and events equal"
# Control: the comparison must notice a single changed row.
q "UPDATE erp_t51_rh_restore.suppliers SET notes = 'changed' WHERE supplier_code_key = 'rh-002'"
if fingerprint erp_t51_rh_restore | diff -q "$OUT/old-before.txt" - >/dev/null; then fail "control: a changed row in the restore went unnoticed"; fi
echo "control: one changed row in the restore is detected"

(cd "$NEW" && DB_NAME=erp_t51_rh_old node scripts/migrate.js | grep '^applied')
fingerprint erp_t51_rh_old > "$OUT/old-after.txt"
diff "$OUT/old-before.txt" "$OUT/old-after.txt" > "$OUT/upgrade-diff.txt" || true
echo "objects changed by the upgrade (< before, > after):"; sed 's/^/  /' "$OUT/upgrade-diff.txt"
if grep -E '^[<>] ' "$OUT/upgrade-diff.txt" | grep -v -E '^[<>] (data|auto) fr_schema_migrations |^[<>] index supplier_sku_refs '; then
  fail "the upgrade changed something other than the ledger and supplier_sku_refs' indexes"
fi
[ "$(orphan)" = refused ] || fail "the orphan SKU relation is still accepted after 0087"
echo "after the upgrade: the orphan SKU relation is refused (DEF-029 fixed); no business data changed"

serve "$NEW" current erp_t51_rh_old
read_through "$NEW" current erp_t51_rh_old
serve "$OLD" previous-rolled-back erp_t51_rh_old
read_through "$OLD" previous-rolled-back erp_t51_rh_old

step "C. Similar-name exception list (HD-057 A), current release, on a sample legacy file"
(cd "$NEW" && node --input-type=module -e '
import fs from "node:fs";
import { stringify } from "csv-stringify/sync";
import { SUPPLIER_IMPORT_COLUMN_NAMES } from "./src/modules/supplier/import/supplierCsvSchema.js";
const rows = [["L-001", "香港貿易有限公司"], ["L-002", "Northwind Paper Co"], ["L-003", "Contoso Trading"], ["L-004", "Contoso Trading Ltd"]];
fs.writeFileSync(process.argv[1], stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...rows.map(([code, name]) =>
  SUPPLIER_IMPORT_COLUMN_NAMES.map((column) => ({ supplierCode: code, supplierName: name, defaultCurrencyCode: "HKD" })[column] ?? ""))]));
' "$OUT/legacy.csv")
rm -f "$OUT/similar.csv"
(cd "$NEW" && DB_NAME=erp_t51_rh_old node src/modules/supplier/similarNameReport.js --database erp_t51_rh_old --mode create_only --input "$OUT/legacy.csv" --output "$OUT/similar.csv")
cat "$OUT/similar.csv"
grep -q '^1,L-001,香港貿易有限公司,existing,' "$OUT/similar.csv" || fail "the exact match with an existing Supplier is missing"

echo; echo "=== all checks passed; the scratch databases are dropped on exit"
