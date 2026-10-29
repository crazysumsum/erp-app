#!/bin/bash
# DEF-049 diagnosis v2 (REV-135 M1, L1, L3). REPORT_ONLY; scratch schema only, created and dropped here.
# Same table as 0062 minus the FK to supplier_import_jobs. Two jobs: job 1 (N rows, every 10th 'warning')
# and job 2 (N rows, all 'valid'), so the index entry after job 1's range belongs to another job.
# Each probe runs in its own REPEATABLE READ transaction; record locks are counted for this thread only,
# and Handler_read_* is read before the data_locks query, so rows_read is the probe's own reads.
# Part 2 shows whether a probe's locks block staging (INSERT) of rows for job 3, the next job id.
S=$SCRATCH
source "$S/env-t51.sh"
export MYSQL_PWD="$DB_ADMIN_PASSWORD"
DB=erp_t51_mig_lockdiag
N=${N:-10000}
q() { "$MYSQL_BIN/mysql" -uroot -S /tmp/m50.sock -N -B "$@"; }
q -e "SELECT CONCAT('version=', @@version, ' port=', @@port, ' default_isolation=', @@transaction_isolation)"
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
SELECT j, n, 'create', JSON_OBJECT('name', CONCAT('S', n)), IF(j = 1 AND n % 10 = 0, 'warning', 'valid'), 0, 0
  FROM s CROSS JOIN (SELECT 1 AS j UNION ALL SELECT 2) jobs;
SQL
COLS="job_id, \`row_number\`, operation, match_supplier_id, expected_supplier_version, normalized_payload, status, warnings"
ASIS="SELECT $COLS FROM supplier_import_rows WHERE job_id = 1 AND status IN ('valid', 'warning') ORDER BY \`row_number\` LIMIT 1 FOR UPDATE"
FXV="SELECT $COLS FROM supplier_import_rows FORCE INDEX (idx_supplier_import_row_status) WHERE job_id = 1 AND status = 'valid' ORDER BY \`row_number\` LIMIT 1 FOR UPDATE"
FXW="SELECT $COLS FROM supplier_import_rows FORCE INDEX (idx_supplier_import_row_status) WHERE job_id = 1 AND status = 'warning' ORDER BY \`row_number\` LIMIT 1 FOR UPDATE"
# REV-135's alternative: non-locking lookups pick the row number, then a unique-key FOR UPDATE locks that row only.
ALT="SELECT LEAST(COALESCE((SELECT \`row_number\` FROM supplier_import_rows FORCE INDEX (idx_supplier_import_row_status) WHERE job_id = 1 AND status = 'valid' ORDER BY \`row_number\` LIMIT 1), 4294967295), COALESCE((SELECT \`row_number\` FROM supplier_import_rows FORCE INDEX (idx_supplier_import_row_status) WHERE job_id = 1 AND status = 'warning' ORDER BY \`row_number\` LIMIT 1), 4294967295)) INTO @r; SELECT $COLS FROM supplier_import_rows WHERE job_id = 1 AND \`row_number\` = @r FOR UPDATE"
probe() { # $1 label, $2 statements
  local out; out=$(q $DB <<SQL
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
FLUSH STATUS;
START TRANSACTION;
$2;
SELECT CONCAT('rows_read=', SUM(VARIABLE_VALUE)) FROM performance_schema.session_status WHERE VARIABLE_NAME IN ('Handler_read_next','Handler_read_key','Handler_read_first','Handler_read_rnd_next','Handler_read_prev');
SELECT CONCAT('locks=', COUNT(*), ' other_job_locks=', COALESCE(SUM(LOCK_DATA NOT LIKE '1,%' AND LOCK_DATA <> 'supremum pseudo-record'), 0), ' supremum=', COALESCE(SUM(LOCK_DATA = 'supremum pseudo-record'), 0)) FROM performance_schema.data_locks WHERE THREAD_ID = PS_CURRENT_THREAD_ID() AND LOCK_TYPE = 'RECORD';
ROLLBACK;
SQL
)
  local picked; picked=$(echo "$out" | grep -vE '^(rows_read|locks)=' | head -1 | cut -f2)
  echo "$1 k=$k picked=${picked:-none} $(echo "$out" | grep -E '^(rows_read|locks)=' | tr '\n' ' ')"
}
setk() { q $DB -e "UPDATE supplier_import_rows SET status = IF(\`row_number\` <= $1, 'applied', IF(\`row_number\` % 10 = 0, 'warning', 'valid')), applied_supplier_id = IF(\`row_number\` <= $1, \`row_number\`, NULL) WHERE job_id = 1; ANALYZE TABLE supplier_import_rows" >/dev/null; }
echo "== part 1: locks and reads per pick (job 1; job 2 follows it in both indexes)"
for k in 0 1 100 1000 5000 9000 9995 9999; do
  setk $k
  probe "as-is     " "$ASIS"
  probe "fx-valid  " "$FXV"
  probe "fx-warning" "$FXW"
  probe "alt       " "$ALT"
done
echo "== part 2: does a pick on job 1 block staging rows for job 3 (INSERT, lock wait timeout 2 s)?"
# The 'warning' entries are the last of job 1 in the status index; with none pending, the empty lookup
# locks the next entry in that index, which is job 2's first. Staging job 3 inserts after job 2's last.
# So the cross-job case is measured on job 2's next neighbour: the pick runs on job 2, which has no 'warning'.
blocktest() { # $1 label, $2 statements holding locks for 5 s
  ( q $DB -e "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; START TRANSACTION; $2; DO SLEEP(5); ROLLBACK;" >/dev/null ) &
  local holder=$!
  perl -e 'select undef,undef,undef,1'
  local t0 t1 res; t0=$(python3 -c 'import time;print(time.time())')
  res=$(q $DB -e "SET SESSION innodb_lock_wait_timeout = 2; INSERT INTO supplier_import_rows (job_id, \`row_number\`, operation, normalized_payload, status, created_at, updated_at) VALUES (3, 1, 'create', JSON_OBJECT(), 'valid', 0, 0); DELETE FROM supplier_import_rows WHERE job_id = 3; SELECT 'inserted'" 2>&1 | tail -1)
  t1=$(python3 -c 'import time;print(time.time())')
  wait $holder
  python3 -c "print('$1 staging job 3: %s (%.1f s)' % ('''$res''', $t1-$t0))"
}
J2W="${FXW//job_id = 1/job_id = 2}"
J2V="${FXV//job_id = 1/job_id = 2}"
J2ASIS="${ASIS//job_id = 1/job_id = 2}"
J2ALT="${ALT//job_id = 1/job_id = 2}"
q $DB -e "UPDATE supplier_import_rows SET status = IF(\`row_number\` <= 5000, 'applied', 'valid'), applied_supplier_id = IF(\`row_number\` <= 5000, \`row_number\`, NULL) WHERE job_id = 2; ANALYZE TABLE supplier_import_rows" >/dev/null
blocktest "control (no pick)  " "DO 0"
blocktest "as-is, job 2 k=5000" "$J2ASIS"
blocktest "fx-valid, job 2    " "$J2V"
blocktest "fx-warning, job 2  " "$J2W"
blocktest "alt, job 2         " "$J2ALT"
q -e "DROP DATABASE $DB"
echo "dropped $DB"
