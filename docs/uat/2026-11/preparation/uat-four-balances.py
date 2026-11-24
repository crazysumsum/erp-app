import json,subprocess,sys
from pathlib import Path
f=Path(__file__).resolve().parents[1]
step=sys.argv[1]
assert step in ['before','main-picked','main-shipped','second-picked','second-shipped']
e=f/'evidence/two-warehouse';file=e/(step+'.json')
def query(sql):
 cmd=['/usr/local/mysql/bin/mysql','--defaults-file='+str(f/'private/mysql-app.cnf'),'--protocol=TCP','-h127.0.0.1','-P3406','erp_uat_rehearse_20261123','-BN','-e',sql]
 return [s.split('\t') for s in subprocess.check_output(cmd,text=True).splitlines()]
rows=query("""SELECT w.warehouse_code,b.bin_code,l.lot_number,l.expiry_date,v.on_hand_quantity FROM inventory_stock_balances v JOIN inventory_warehouses w ON w.id=v.warehouse_id JOIN inventory_bins b ON b.id=v.bin_id JOIN inventory_lots l ON l.id=v.lot_id JOIN item_skus s ON s.id=v.sku_id WHERE s.sku_code='UAT-B1' AND v.stock_status='AVAILABLE' ORDER BY w.id,l.id""")
assert len(rows)==4
orders=[]
for wh in ['UAT-MAIN','UAT-SECOND']:
 st=json.loads((e/(wh+'.json')).read_text());oid=int(st['orderId'])
 order=query(f"SELECT w.warehouse_code,sl.ordered_base_quantity,sl.reserved_outstanding_base_quantity,sl.backordered_base_quantity,sl.fulfilled_base_quantity FROM sales_order_lines sl JOIN sales_orders so ON so.id=sl.sales_order_id JOIN inventory_warehouses w ON w.id=so.fulfillment_warehouse_id WHERE so.id={oid}")
 orders.extend(order)
if step=='before':assert all(r[1:]==['2','2','0','0'] for r in orders)
else:
 base=json.loads((e/'before.json').read_text())['balances']
 for old,new in zip(base,rows):
  assert old[:4]==new[:4];deduct=2 if new[2]=='UAT-B1-EARLY' and step in ['main-shipped','second-picked','second-shipped'] or new[2]=='UAT-B1-SECOND-1124' and step=='second-shipped' else 0
  assert int(new[4])==int(old[4])-deduct,(old,new)
issue=[]
if step.endswith('shipped'):
 idx=0 if step=='main-shipped' else 1;wh=orders[idx][0];assert orders[idx][1:]==['2','0','0','2']
 st=json.loads((e/(wh+'.json')).read_text());sid=int(st['shipId'])
 issue=query(f"SELECT m.id,m.movement_type,m.direction,m.quantity,m.warehouse_code_snapshot,m.bin_code_snapshot,m.lot_number_snapshot,m.expiry_date_snapshot,m.balance_before,m.balance_after FROM shipment_issue_details i JOIN inventory_movements m ON m.id=i.inventory_movement_id WHERE i.shipment_id={sid}")
 assert len(issue)==1 and issue[0][1:8]==['ISSUE','OUT','2',wh,'UAT-PICK',st['lot'],st['expiry']],issue
data={'stage':step,'balances':rows,'orders':orders,'issue':issue}
with file.open('x') as out:json.dump(data,out,indent=2)
print(step,rows,orders,issue)
