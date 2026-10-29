#!/bin/bash
# DEF-050 diagnosis (HD-155 A, REPORT_ONLY): why for-SKU name search p95 sits near 2 s at 100k under 50 users.
# Throwaway schema erp_t51_mig_d50 (created, migrated, seeded like the performance runner, dropped at the end).
# E1: --only=forSku at 1, 10, 25, 50 users (latency against concurrency; users=1 gives each statement's cost alone).
# E2: 50 users, only the operations without q (forSku.typical) and only forSku.nameSearch.
S=$SCRATCH
OUT=$S/d50
cd $WORKTREE/server || exit 2
source "$S/env-t51.sh"
DB=erp_t51_mig_d50
export DB_NAME=$DB DB_USER=$DB_ADMIN_USER DB_PASSWORD=$DB_ADMIN_PASSWORD DB_SOCKET_PATH= DB_SSL_ENABLED=false
adm() { MYSQL_PWD="$DB_ADMIN_PASSWORD" "$MYSQL_BIN/mysql" -uroot -S /tmp/m50.sock -N "$@"; }
adm -e "SELECT CONCAT_WS(' ', @@version, @@port, @@performance_schema_max_sql_text_length, @@innodb_buffer_pool_size)"
adm -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
node scripts/migrate.js > "$OUT/migrate.log" 2>&1 || { echo "migrate failed"; exit 3; }
t0=$(date -u +%H:%M:%S); node scripts/seedSupplierPerformanceFixtures.js --database=$DB --suppliers=100000 --heavy-percent=1 > "$OUT/seed.log" 2>&1 || { echo "seed failed"; tail -5 "$OUT/seed.log"; exit 4; }
echo "seeded $t0-$(date -u +%H:%M:%S)"
bench() { # $1 label, $2 users, $3 only
  adm -e "TRUNCATE performance_schema.events_statements_summary_by_digest"
  node scripts/benchmarkSupplierManagement.js --database=$DB --users=$2 --seconds=60 --warmup-seconds=10 --think-ms=1000 --only=$3 \
    --output="$OUT/$1.json" > "$OUT/$1.stdout" 2> "$OUT/$1.stderr"
  python3 - "$OUT/$1.json" "$1" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); rep=d.get('report',d)
ops=rep.get('operations') or {}
o=' '.join(f"{n.split('.')[1]}={v['p50']:.0f}/{v['p95']:.0f}" for n,v in ops.items())
tot=sum(s.get('totalMs',0) for s in rep.get('topStatements') or [])
q=[s for s in rep.get('topStatements') or [] if 'LIKE' in s['digest']]
print(f"{sys.argv[2]}: n={rep['overall']['count']} tput={rep['overall']['throughputPerSecond']}/s p50/p95 overall={rep['overall']['p50']:.0f}/{rep['overall']['p95']:.0f} | {o}")
print(f"   db busy ~{tot/1000/70:.1f} conns; LIKE statements: " + '; '.join(f"avg {s['avgMs']:.0f} ms x{s['count']} rows {s.get('rowsExaminedPerCall')}" for s in q[:3]))
PY
}
for u in 1 10 25 50; do bench "forsku-u$u" $u forSku; done
bench "typical-u50" 50 forSku.typical
bench "namesearch-u50" 50 forSku.nameSearch
adm -e "DROP DATABASE $DB"; echo "dropped $DB"
