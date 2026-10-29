#!/bin/bash
# REV-132 O3 diagnosis (REPORT_ONLY): does processNextRow's row SELECT ... FOR UPDATE lock rows already applied?
# Exact DDL of 0062 minus the FK to supplier_import_jobs (the jobs table is not needed for the plan or the locks).
# One job of N rows; for each k, rows 1..k are 'applied', the rest 'valid' (W of them 'warning'), then the
# exact query from SupplierImportService.js:653 runs in a transaction and we count its record locks and rows read.
S=$SCRATCH
source "$S/env-t51.sh"
export MYSQL_PWD="$DB_ADMIN_PASSWORD"
DB=erp_t51_mig_lockdiag
N=${N:-10000}
q() { "$MYSQL_BIN/mysql" -uroot -S /tmp/m50.sock -N -B "$@"; }
q -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
q $DB <<SQL
CREATE TABLE supplier_import_rows (
  job_id BIGINT UNSIGNED NOT NULL, \`row_number\` INT UNSIGNED NOT NULL,
  operation VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  match_supplier_id BIGINT UNSIGNED NULL, expected_supplier_version INT UNSIGNED NULL,
  normalized_payload JSON NOT NULL, status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_supplier_id BIGINT UNSIGNED NULL, errors JSON NULL, warnings JSON NULL,
  started_at BIGINT UNSIGNED NULL, completed_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (job_id, \`row_number\`),
  KEY idx_supplier_import_row_status (job_id, status, \`row_number\`),
  CONSTRAINT chk_supplier_import_row_applied CHECK ((status = 'applied') = (applied_supplier_id IS NOT NULL))
);
SET SESSION cte_max_recursion_depth = 1000000;
INSERT INTO supplier_import_rows (job_id, \`row_number\`, operation, normalized_payload, status, created_at, updated_at)
WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < $N)
SELECT 1, n, 'create', JSON_OBJECT('name', CONCAT('S', n)), IF(n % 10 = 0, 'warning', 'valid'), 0, 0 FROM s;
SQL
SEL="SELECT job_id, \`row_number\`, operation, match_supplier_id, expected_supplier_version, normalized_payload, status, warnings FROM supplier_import_rows"
WHERE="WHERE job_id = 1 AND status IN ('valid', 'warning') ORDER BY \`row_number\` LIMIT 1 FOR UPDATE"
probe() { # $1 label, $2 FROM-suffix (index hint), $3 WHERE clause
  q $DB -e "ANALYZE TABLE supplier_import_rows" >/dev/null
  local plan; plan=$(q $DB -e "EXPLAIN FORMAT=TREE $SEL $2 $3" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-260)
  local out; out=$(q $DB <<SQL
FLUSH STATUS;
BEGIN;
$SEL $2 $3;
SELECT CONCAT('locks=', COUNT(*)) FROM performance_schema.data_locks WHERE OBJECT_SCHEMA = '$DB' AND LOCK_TYPE = 'RECORD';
SELECT CONCAT('rows_read=', SUM(VARIABLE_VALUE)) FROM performance_schema.session_status WHERE VARIABLE_NAME IN ('Handler_read_next','Handler_read_key','Handler_read_first','Handler_read_rnd_next');
ROLLBACK;
SQL
)
  echo "$1 k=$k picked=$(echo "$out" | head -1 | cut -f2) $(echo "$out" | grep -E '^(locks|rows_read)=' | tr '\n' ' ') plan: $plan"
}
for k in 0 1000 2500 5000 7500 9000; do
  q $DB -e "UPDATE supplier_import_rows SET status = IF(\`row_number\` <= $k, 'applied', IF(\`row_number\` % 10 = 0, 'warning', 'valid')), applied_supplier_id = IF(\`row_number\` <= $k, \`row_number\`, NULL) WHERE job_id = 1; ANALYZE TABLE supplier_import_rows" >/dev/null
  for v in as-is eq-valid; do
    if [ $v = as-is ]; then W="$WHERE"; else W="WHERE job_id = 1 AND status = 'valid' ORDER BY \`row_number\` LIMIT 1 FOR UPDATE"; fi
    f=$(mktemp); for i in $(seq 200); do echo "BEGIN; $SEL $W; ROLLBACK;"; done > $f
    t0=$(python3 -c 'import time;print(time.time())'); q $DB < $f >/dev/null; t1=$(python3 -c 'import time;print(time.time())')
    python3 -c "print('$v k=$k ms_per_pick=%.3f' % (($t1-$t0)*1000/200))"; rm -f $f
  done
done
q -e "DROP DATABASE $DB"
echo "dropped $DB"
