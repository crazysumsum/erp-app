#!/bin/bash
# DEF-050 diagnosis E5 (REV-137 H3): the non-q for-SKU rest page (forSku.cold, forSku.deepPage) as MySQL plans it today
# (idx_suppliers_status_updated_id + filesort) against FORCE INDEX (idx_suppliers_name_id), at several offsets, quiet DB.
# Throwaway schema erp_t51_mig_d50, migrated and seeded as the performance runner does, dropped at the end. SQL as in
# SupplierLookupService.listForSku (restFrom with no search). 10 runs per point, inside BEGIN/ROLLBACK.
S=$SCRATCH
OUT=$S/d50
cd $WORKTREE/server || exit 2
source "$S/env-t51.sh"
DB=erp_t51_mig_d50
export DB_NAME=$DB DB_USER=$DB_ADMIN_USER DB_PASSWORD=$DB_ADMIN_PASSWORD DB_SOCKET_PATH= DB_SSL_ENABLED=false
adm() { MYSQL_PWD="$DB_ADMIN_PASSWORD" "$MYSQL_BIN/mysql" -uroot -S /tmp/m50.sock -N -B "$@"; }
adm -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
node scripts/migrate.js > "$OUT/restplan-migrate.log" 2>&1 || { echo "migrate failed"; exit 3; }
node scripts/seedSupplierPerformanceFixtures.js --database=$DB --suppliers=100000 --heavy-percent=1 > "$OUT/restplan-seed.log" 2>&1 || { echo "seed failed"; exit 4; }
adm $DB -e "ANALYZE TABLE suppliers, supplier_sku_refs" >/dev/null
HOT=$(adm $DB -e "SELECT id FROM item_skus WHERE sku_code = 'PERF-SKU-HOT'"); COLD=$(adm $DB -e "SELECT id FROM item_skus WHERE sku_code = 'PERF-SKU-COLD'")
echo "hot=$HOT cold=$COLD active=$(adm $DB -e "SELECT COUNT(*) FROM suppliers WHERE status='active'")"
COLS="s.id, s.supplier_code, s.supplier_name, s.display_name, s.default_currency_code, s.default_payment_term_id, s.status, s.version, r.id AS relation_id, r.relationship_status, r.supplier_item_code, r.last_supplied_at"
RANKED="r.relationship_status = 'preferred' OR (r.relationship_status <> 'stopped' AND r.last_supplied_at IS NOT NULL)"
rest() { # $1 index hint, $2 sku, $3 offset
  echo "SELECT $COLS, 1 AS exact_rank FROM suppliers s $1 LEFT JOIN supplier_sku_refs r ON r.supplier_id = s.id AND r.sku_id = $2 WHERE s.status = 'active' AND NOT COALESCE(($RANKED), FALSE) ORDER BY s.supplier_name, s.id LIMIT 20 OFFSET $3"
}
for sku in cold:$COLD hot:$HOT; do
  name=${sku%%:*}; id=${sku#*:}
  for off in 0 10000 40000 69000; do
    for hint in default "FORCE INDEX (idx_suppliers_name_id)"; do
      h=$([ "$hint" = default ] && echo "" || echo "$hint")
      plan=$(adm $DB -e "EXPLAIN FORMAT=TREE $(rest "$h" $id $off)" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-150)
      f=$(mktemp); for i in $(seq 10); do echo "$(rest "$h" $id $off);"; done > $f
      t0=$(python3 -c 'import time;print(time.time())'); adm $DB < $f > /dev/null; t1=$(python3 -c 'import time;print(time.time())'); rm -f $f
      python3 -c "print('$name off=$off ${hint:0:13}: %.1f ms/query' % (($t1-$t0)*100))"
      echo "    plan: $plan"
    done
  done
done
adm -e "DROP DATABASE $DB"; echo "dropped $DB"
