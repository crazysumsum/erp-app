import csv,json,sys,subprocess
from pathlib import Path
u=Path(__file__).resolve().parents[1]
e=u/'evidence'
def rows(sql):
 cmd=['/usr/local/mysql/bin/mysql','--defaults-file='+str(u/'private/mysql-app.cnf'),'--protocol=TCP','--host=127.0.0.1','--port=3406','--database=erp_uat_rehearse_20261123','-BN','-e',sql]
 return [r.split('\t') for r in subprocess.check_output(cmd,text=True).splitlines()]
balances=rows("""SELECT w.warehouse_code,b.bin_code,s.sku_code,COALESCE(l.lot_number,''),COALESCE(CAST(l.expiry_date AS CHAR),''),v.stock_status,v.on_hand_quantity,v.allocated_quantity FROM inventory_stock_balances v JOIN inventory_warehouses w ON w.id=v.warehouse_id JOIN inventory_bins b ON b.id=v.bin_id JOIN item_skus s ON s.id=v.sku_id LEFT JOIN inventory_lots l ON l.id=v.lot_id ORDER BY v.id""")
moves=rows("""SELECT warehouse_code_snapshot,bin_code_snapshot,sku_code_snapshot,COALESCE(lot_number_snapshot,''),COALESCE(CAST(expiry_date_snapshot AS CHAR),''),stock_status,quantity,direction,balance_before,balance_after FROM inventory_movements WHERE movement_type='OPENING' ORDER BY id""")
snapshot=dict(balances=balances,opening=moves,count=int(rows('SELECT COUNT(*) FROM inventory_movements')[0][0]))
phase=sys.argv[1]
(e/('opening-ledger-'+phase+'.json')).write_text(json.dumps(snapshot,indent=2))
if phase=='before':assert not moves
else:
 before=json.loads((e/'opening-ledger-before.json').read_text())
 if phase=='invalid':assert snapshot==before
 else:
  with (u/'preparation/02-opening-valid.csv').open() as f:expected=[r for r in list(csv.reader(f))[1:] if int(r[6])>0]
  assert sorted(r[:7] for r in moves)==sorted(expected),moves
  assert all(r[7:] == ['IN','0',r[6]] for r in moves)
  assert sorted(balances)==sorted(before['balances']+[r+['0'] for r in expected])
  assert snapshot['count']==before['count']+8 and sum(int(r[6]) for r in moves)==552
print(phase,len(balances),'balances,',snapshot['count'],'movements,',len(moves),'opening')
