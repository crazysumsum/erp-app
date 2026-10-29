#!/bin/bash
# DEF-050 diagnosis (HD-155 A, REPORT_ONLY): why for-SKU name search p95 sits near 2 s at 100k under 50 users.
# Throwaway schema erp_t51_mig_d50 (created, migrated, seeded like the performance runner, dropped at the end).
# E3: the same for-SKU load at 50 users with the app pool raised from 10 to 20, in a throwaway detached worktree
# (uncommitted one-line change to server/config/database.js; the worktree is removed afterwards). Is the pool or MySQL the limit?
S=$SCRATCH
OUT=$S/d50
cd $THROWAWAY_WORKTREE/server || exit 2
source "$S/env-t51.sh"
DB=erp_t51_mig_d50
export DB_NAME=$DB DB_USER=$DB_ADMIN_USER DB_PASSWORD=$DB_ADMIN_PASSWORD DB_SOCKET_PATH= DB_SSL_ENABLED=false
adm() { MYSQL_PWD="$DB_ADMIN_PASSWORD" "$MYSQL_BIN/mysql" -uroot -S /tmp/m50.sock -N "$@"; }
adm -e "SELECT CONCAT_WS(' ', @@version, @@port, @@performance_schema_max_sql_text_length, @@innodb_buffer_pool_size)"
adm -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
node scripts/migrate.js > "$OUT/pool20-migrate.log" 2>&1 || { echo "migrate failed"; exit 3; }
t0=$(date -u +%H:%M:%S); node scripts/seedSupplierPerformanceFixtures.js --database=$DB --suppliers=100000 --heavy-percent=1 > "$OUT/pool20-seed.log" 2>&1 || { echo "seed failed"; tail -5 "$OUT/pool20-seed.log"; exit 4; }
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
grep -n "connectionLimit: 20," config/database.js || exit 5
bench "pool20-forsku-u50" 50 forSku
adm -e "DROP DATABASE $DB"; echo "dropped $DB"
