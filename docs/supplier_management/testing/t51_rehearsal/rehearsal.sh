#!/bin/bash
# T51 rehearsal on a THROWAWAY MySQL: two upgrade paths, backup/restore, two server rollbacks and the similar-name list.
#
#   PRE_WORKTREE  checkout of main before Supplier existed (b3e5aa90^1), npm ci done
#   OLD_WORKTREE  checkout of an older release (72e205ef, before 0087), npm ci done
#   PREV_WORKTREE checkout of the release just before 0103 (e6398b70), npm ci done
#   NEW_WORKTREE  checkout of the current release
#   SCRATCH       directory for the output
#   REHEARSAL_SOCKET, REHEARSAL_PORT, REHEARSAL_USER, REHEARSAL_PASSWORD  the throwaway instance (no defaults)
#
# It refuses to run unless the server on the socket reports REHEARSAL_PORT, it only creates and drops databases named
# erp_t51_rh_*, and it exits non-zero on the first failed check (REV-105 H-1, L-2).
set -euo pipefail
: "${PRE_WORKTREE:?}" "${OLD_WORKTREE:?}" "${PREV_WORKTREE:?}" "${NEW_WORKTREE:?}" "${SCRATCH:?}"
: "${REHEARSAL_SOCKET:?}" "${REHEARSAL_PORT:?}" "${REHEARSAL_USER:?}" "${REHEARSAL_PASSWORD:?}"
HERE=$(cd "$(dirname "$0")" && pwd)
PRE=$PRE_WORKTREE/server OLD=$OLD_WORKTREE/server PREV=$PREV_WORKTREE/server NEW=$NEW_WORKTREE/server OUT=$SCRATCH/t51
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
# and events. AUTO_INCREMENT is read with the statistics cache off: by default information_schema serves it from a cache
# that lives a day (information_schema_stats_expiry), so a changed counter went unseen (REV-128 R2).
fingerprint() {
  local db=$1 t sum count=0
  while read -r t; do
    [ -z "$t" ] && continue
    sum=$(q "CHECKSUM TABLE \`$db\`.\`$t\`" | cut -f2)
    { [ -n "$sum" ] && [ "$sum" != NULL ]; } || fail "no checksum for $db.$t"
    echo "data $t $sum"; count=$((count + 1))
  done < <(q "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY table_name")
  [ "$count" = "$(q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE'")" ] || fail "table count mismatch in $db"
  q "SET SESSION information_schema_stats_expiry = 0; SELECT CONCAT_WS(' ', 'auto', table_name, IFNULL(auto_increment,'-')) FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY table_name"
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

# A server that must refuse to start: it has to exit non-zero, without listening, with the expected message ($4).
refuse_start() { # $1 server dir, $2 label, $3 database, $4 message
  local port log pid
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
  log=$OUT/server-$2.log
  ( cd "$(mktemp -d)" && DB_NAME=$3 APP_PORT=$port exec node "$1/src/index.js" ) > "$log" 2>&1 &
  pid=$!; PIDS+=("$pid")
  for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; grep -q "API listening" "$log" && break; sleep 0.5; done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid"; wait "$pid" 2>/dev/null || true; fail "$2 server started; it should have refused"; fi
  if wait "$pid"; then fail "$2 server exited 0; it should have refused"; fi
  grep -q "$4" "$log" || fail "$2 server stopped for another reason: $(tail -3 "$log")"
  echo "$2 server: refused to start, as expected ($4)"
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

step "B. Older release 72e205ef (before 0087) with business data: backup/restore, upgrade, rollback to it"
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
   INSERT INTO erp_t51_rh_old.supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, @sku, 1, 1 FROM erp_t51_rh_old.suppliers WHERE supplier_code_key = 'rh-001';
   INSERT INTO erp_t51_rh_old.supplier_addresses (supplier_id, label, address_line1, created_at, updated_at)
   SELECT id, label, line, 1, 1 FROM erp_t51_rh_old.suppliers, (SELECT 'Head office' AS label, '1 Queen''s Road' AS line UNION ALL SELECT 'Warehouse', '2 Kwai Chung Road') a WHERE supplier_code_key = 'rh-001';
   INSERT INTO erp_t51_rh_old.supplier_contacts (supplier_id, name, created_at, updated_at) SELECT id, 'Chan Tai Man', 1, 1 FROM erp_t51_rh_old.suppliers WHERE supplier_code_key = 'rh-001';"
orphan() { if q "START TRANSACTION; INSERT INTO erp_t51_rh_old.supplier_sku_refs (supplier_id, sku_id, created_at, updated_at) SELECT id, 999999999, 1, 1 FROM erp_t51_rh_old.suppliers WHERE supplier_code_key='rh-002'; ROLLBACK;" >/dev/null 2>&1; then echo accepted; else echo refused; fi; }
[ "$(orphan)" = accepted ] || fail "control: the previous release should still accept an orphan SKU relation (DEF-029)"
echo "previous release: an orphan SKU relation is accepted (DEF-029, control)"
read_through "$OLD" older erp_t51_rh_old

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
# Control: a counter that moved with the data unchanged (a row added and removed) must show, and only as the counter.
q "UPDATE erp_t51_rh_restore.suppliers SET notes = '' WHERE supplier_code_key = 'rh-002';
   INSERT INTO erp_t51_rh_restore.suppliers (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name, default_currency_code, website, general_phone, general_email, notes, status, created_at, updated_at)
   VALUES ('RH-X', 'rh-x', 'x', 'x', '', 'HKD', '', '', '', '', 'draft', 1, 1);
   DELETE FROM erp_t51_rh_restore.suppliers WHERE supplier_code_key = 'rh-x'"
[ "$(fingerprint erp_t51_rh_restore | diff "$OUT/old-before.txt" - | grep '^[<>]' | cut -d' ' -f2,3 | sort -u)" = "auto suppliers" ] \
  || fail "control: a moved AUTO_INCREMENT counter went unnoticed, or showed as more than the counter"
echo "control: a moved AUTO_INCREMENT counter alone is detected"

# Pre-existing permission rows (the restore holds the before-image) that differ byte for byte after the upgrade. BINARY,
# because the columns' collation ignores case and accents.
PERM_CHANGES="SELECT COUNT(*) FROM erp_t51_rh_restore.permissions b WHERE NOT EXISTS (SELECT 1 FROM erp_t51_rh_old.permissions a
  WHERE a.id = b.id AND CAST(a.name AS BINARY) <=> CAST(b.name AS BINARY)
    AND CAST(a.description AS BINARY) <=> CAST(b.description AS BINARY) AND a.created_at <=> b.created_at)"

(cd "$NEW" && DB_NAME=erp_t51_rh_old node scripts/migrate.js | grep '^applied')
fingerprint erp_t51_rh_old > "$OUT/old-after.txt"
diff "$OUT/old-before.txt" "$OUT/old-after.txt" > "$OUT/upgrade-diff.txt" || true
echo "objects changed by the upgrade (< before, > after):"; sed 's/^/  /' "$OUT/upgrade-diff.txt"
# Every object of a table that existed before the upgrade must be unchanged, except: the ledger; 0087's two
# supplier_sku_refs indexes; 0103's added sort_order on supplier_addresses and supplier_contacts, and the data of those
# two tables (0103 fills sort_order; every other column is compared row by row below); new permission rows
# (the data, checked row by row below, and a counter that may only go up). Tables the upgrade creates (other modules'
# 0088+) and new routines, views or events are additions, not changes.
# Generalised on 2026-10-27, when main gained 0088-0103: the first version listed only 0087's changes; narrowed after
# REV-128.
awk '$1=="data"{print $2}' "$OUT/old-before.txt" > "$OUT/existing-tables.txt"
unexpected_changes() {
  # The table list comes from a file: BSD awk drops a multi-line -v value without an error, which made every table look new.
  grep -E '^[<>] ' | awk '
    NR == FNR { old[$1] = 1; next }
    { side = $1; kind = $2; table = $3 }
    kind == "tables" { next }
    kind == "routine" || kind == "view" || kind == "event" { if (side == "<") print; next }
    !(table in old) { next }
    (kind == "data" || kind == "auto") && table == "fr_schema_migrations" { next }
    kind == "index" && table == "supplier_sku_refs" && ($4 == "idx_supplier_sku_refs_sku" || $4 == "idx_supplier_sku_refs_sku_status_supplied") { next }
    kind == "column" && (table == "supplier_addresses" || table == "supplier_contacts") && $4 == "sort_order" && side == ">" { next }
    kind == "data" && table == "permissions" { next }
    kind == "data" && (table == "supplier_addresses" || table == "supplier_contacts") { next }
    kind == "auto" && table == "permissions" { counter[side] = $4; next }
    { print }
    END { if (counter["<"] != "" && counter[">"] + 0 < counter["<"] + 0) print "auto permissions went down" }' "$OUT/existing-tables.txt" -
}
# Controls: each of these changes to a pre-existing table must be reported.
for change in '> column suppliers unexpected_col 99 int NO 0 -' '> index supplier_sku_refs idx_unexpected 1 1 sku_id' \
  '< column supplier_contacts sort_order 17 int NO 0 -' '< auto suppliers 3\n> auto suppliers 4' '< auto permissions 38\n> auto permissions 30'; do
  [ -n "$(printf "$change\n" | unexpected_changes)" ] || fail "control: '$change' went unnoticed"
done
unexpected=$(unexpected_changes < "$OUT/upgrade-diff.txt" || true)
changed_permissions=$(q "$PERM_CHANGES")
# Every column the two party tables had before 0103, row by row, hex-encoded, against the before-image in the restore.
party_rows() { # $1 database, $2 table
  q "SELECT CONCAT_WS('|', $(q "SELECT GROUP_CONCAT(CONCAT('IFNULL(HEX(\`', column_name, '\`), ''NULL'')') ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema = 'erp_t51_rh_restore' AND table_name = '$2'")) FROM \`$1\`.\`$2\` ORDER BY id"
}
for t in supplier_addresses:2 supplier_contacts:1; do
  [ "$(party_rows erp_t51_rh_restore "${t%:*}" | grep -c .)" = "${t#*:}" ] || fail "expected ${t#*:} rows in ${t%:*} before the upgrade"
  diff <(party_rows erp_t51_rh_restore "${t%:*}") <(party_rows erp_t51_rh_old "${t%:*}") || fail "0103 changed a column of ${t%:*} other than sort_order"
done
# Control: a case-only change to one existing permission, in a transaction that is rolled back, must be counted.
# (The descriptions are Chinese, which has no case, so the ASCII name is changed.)
[ "$(q "START TRANSACTION; UPDATE erp_t51_rh_old.permissions SET name = UPPER(name)
  WHERE id < (SELECT COALESCE(MAX(id), 0) + 1 FROM erp_t51_rh_restore.permissions)
    AND CAST(name AS BINARY) <> CAST(UPPER(name) AS BINARY) ORDER BY id LIMIT 1; $PERM_CHANGES; ROLLBACK")" = 1 ] \
  || fail "control: a case-only change to an existing permission went unnoticed"
if [ -n "$unexpected" ] || [ "$changed_permissions" != 0 ]; then
  echo "$unexpected"; echo "pre-existing permission rows changed or missing: $changed_permissions"
  fail "the upgrade changed a pre-existing object beyond the ledger, 0087's index, 0103's sort_order and new permission rows"
fi
[ "$(orphan)" = refused ] || fail "the orphan SKU relation is still accepted after 0087"
echo "after the upgrade: the orphan SKU relation is refused (DEF-029 fixed); no business data changed"
party_order() { echo "$(q "SELECT GROUP_CONCAT(p.sort_order ORDER BY p.id) FROM erp_t51_rh_old.supplier_addresses p
  JOIN erp_t51_rh_old.suppliers s ON s.id = p.supplier_id WHERE s.supplier_code_key = 'rh-001'")/$(q "SELECT GROUP_CONCAT(p.sort_order ORDER BY p.id)
  FROM erp_t51_rh_old.supplier_contacts p JOIN erp_t51_rh_old.suppliers s ON s.id = p.supplier_id WHERE s.supplier_code_key = 'rh-001'")"; }
[ "$(party_order)" = "1,2/1" ] || fail "0103 did not number the existing addresses and contacts in display order: $(party_order)"
echo "0103 numbered the existing rows in display order: addresses 1,2; contact 1; every other column of those rows unchanged"

serve "$NEW" current erp_t51_rh_old
read_through "$NEW" current erp_t51_rh_old
# 72e205ef has no startup schema check, so it starts on the upgraded schema as it is. It is not the release before 0103.
serve "$OLD" older-rolled-back erp_t51_rh_old
read_through "$OLD" older-rolled-back erp_t51_rh_old

step "C. Rolling back across 0103 to the release just before it (e6398b70), by the procedure in 0103's header"
# e6398b70's startup check (DEF-033) compares the Supplier tables with its own 0032/0033 inspectors, which reject the extra
# column. So a plain rollback fails, and the documented manual steps are required (REV-118 L-1, REV-128 R1).
refuse_start "$PREV" pre-0103-on-0103-schema erp_t51_rh_old "Supplier startup self-check failed"
# The statements are taken from the migration's header, so the rehearsal runs the documented text itself.
rollback_sql=$(sed -n -E 's#^//   ((ALTER TABLE supplier_(addresses|contacts) DROP COLUMN sort_order|DELETE FROM fr_schema_migrations WHERE .*0103_.*);)$#\1#p' \
  "$NEW/database/migrations/0103_add_supplier_party_sort_order.js")
[ "$(printf '%s\n' "$rollback_sql" | grep -c .)" = 3 ] || fail "0103's header no longer holds the three rollback statements"
printf '%s\n' "$rollback_sql" | sed 's/^/  /'
q "USE erp_t51_rh_old; $rollback_sql"
fingerprint erp_t51_rh_old > "$OUT/rolled-back.txt"
diff <(grep -E '^(column|index) supplier_(addresses|contacts) ' "$OUT/old-before.txt") \
     <(grep -E '^(column|index) supplier_(addresses|contacts) ' "$OUT/rolled-back.txt") || fail "the address and contact tables are not back to their pre-0103 shape"
[ "$(q "SELECT COUNT(*) FROM erp_t51_rh_old.fr_schema_migrations WHERE name LIKE '%0103_%'")" = 0 ] || fail "0103 is still in the ledger"
[ "$(q "SELECT (SELECT COUNT(*) FROM erp_t51_rh_old.supplier_addresses), (SELECT COUNT(*) FROM erp_t51_rh_old.supplier_contacts)")" = "$(printf '2\t1')" ] \
  || fail "address or contact rows were lost by the rollback"
echo "after the manual steps: both tables back to their pre-0103 columns and indexes, 0103 out of the ledger, every row kept"
serve "$PREV" pre-0103-rolled-back erp_t51_rh_old
read_through "$PREV" pre-0103-rolled-back erp_t51_rh_old
echo "rolling forward again with the current release:"
reapplied=$(cd "$NEW" && DB_NAME=erp_t51_rh_old node scripts/migrate.js | grep '^applied' || true)
printf '%s\n' "$reapplied" | sed 's/^/  /'
case "$reapplied" in *0103_*) ;; *) fail "0103 was not applied again" ;; esac
[ "$(party_order)" = "1,2/1" ] || fail "0103 did not number the rows again: $(party_order)"
echo "0103 applied again and the rows renumbered in display order (an order users set before the rollback is not restored)"
serve "$NEW" current-rolled-forward erp_t51_rh_old
read_through "$NEW" current-rolled-forward erp_t51_rh_old

step "D. Similar-name exception list (HD-057 A), current release, on a sample legacy file"
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
