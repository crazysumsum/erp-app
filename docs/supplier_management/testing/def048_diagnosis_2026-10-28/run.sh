#!/bin/bash
# DEF-048 diagnosis (HD-152 A): rerun the performance runner with server logs kept, until online create gets a 500.
# Throwaway worktree, uncommitted change, not formal evidence. At most 3 runs.
S=$SCRATCH
OUT=$S/diag048
cd $WORKTREE/server || exit 2
source "$S/env-t51.sh"
export DB_INTEGRATION_TESTS=1
for n in 1 2 3; do
  MYSQL_PWD=root /usr/local/mysql/bin/mysql -uroot -S /tmp/m50.sock -e "TRUNCATE performance_schema.events_statements_summary_by_digest"
  echo "run $n start $(date -u +%H:%M:%S)"
  node scripts/runSupplierPerformanceAcceptance.js --output "$OUT/perf-$n.json" > "$OUT/perf-$n.stdout" 2> "$OUT/perf-$n.stderr"
  echo "run $n exit $? end $(date -u +%H:%M:%S)"
  errs=$(python3 -c "
import json,sys
t=open(sys.argv[1]).read(); d=json.loads(t[t.index('{'):t.rindex('}')+1])
s=json.dumps(d['evidence'].get('loadDuringImport',{}))
print(d['evidence'].get('loadDuringImport',{}).get('overall',{}).get('errorRate'))" "$OUT/perf-$n.stdout" 2>&1)
  echo "run $n loadDuringImport errorRate=$errs"
  case "$errs" in 0|0.0|None|"") ;; *) echo "errors seen: stop"; break ;; esac
done
echo "kept log dirs:"; ls -d "$(node -e "console.log(require('os').tmpdir())")"/supplier-perf-* 2>/dev/null
