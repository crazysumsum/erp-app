"""Operate only the clean rehearsal API and frontend. The shared MySQL remains up."""
import importlib.util,os,signal,subprocess as sp,sys,time,shutil,socket,hashlib,datetime as dt
from pathlib import Path
f=Path(__file__).resolve().parents[1]
u=f.parent.parent
assert f.name=='full-d434d74c' and u.name=='erp-uat'
spec=importlib.util.spec_from_file_location('uat_service',u/'preparation/uat-services.py')
svc=importlib.util.module_from_spec(spec);spec.loader.exec_module(svc)
svc.run=f/'run'
svc.services={name:([s.replace(str(u),str(f)) for s in command],Path(str(cwd).replace(str(u),str(f)))) for name,(command,cwd) in svc.services.items()}
db='erp_uat_rehearse_20261123'
def check_db():
 config=dict(l.split('=',1) for l in (f/'app/server/.env').read_text().splitlines() if '=' in l)
 assert config['DB_NAME']==db and config['DB_HOST']=='127.0.0.1' and config['DB_PORT']=='3406'
 actual=sp.check_output(['/usr/local/mysql/bin/mysql',f'--defaults-file={f}/private/mysql-app.cnf','--protocol=TCP','-h127.0.0.1','-P3406',db,'-BN','-e','SELECT DATABASE(),@@port'],text=True).split()
 assert actual==[db,'3406']
def start():
 check_db()
 waiting=[]
 for name,port in [('api',3100),('client',5273)]:
  if not svc.running(name):
   with socket.socket() as s:
    if s.connect_ex(('127.0.0.1',port))==0:raise SystemExit(f'{port} is already occupied. Check the active rehearsal before switching.')
   waiting.append(name)
 for name in waiting:
  cmd,cwd=svc.services[name]
  with (f/'run'/(name+'.log')).open('ab') as log:
   proc=sp.Popen(cmd,cwd=cwd,stdin=sp.DEVNULL,stdout=log,stderr=log,start_new_session=True)
  (f/'run'/(name+'.pid')).write_text(str(proc.pid)+'\n')
def stop():
 for name in ['client','api']:
  pid=svc.running(name)
  if pid:
   os.kill(pid,signal.SIGTERM)
   for _ in range(160):
    if not svc.running(name):break
    time.sleep(.1)
   else:raise SystemExit(f'{name} did not stop')
def status():
 check_db()
 print(db, {name:svc.running(name) for name in svc.services})
def backup():
 check_db()
 dest=f/'backup'/dt.datetime.now().strftime('%Y%m%d-%H%M%S')
 dest.mkdir(mode=0o700)
 with (dest/(db+'.sql.partial')).open('xb') as out:
  sp.run(['/usr/local/mysql/bin/mysqldump',f'--defaults-file={u}/private/mysql-root.cnf','--protocol=SOCKET','-hlocalhost',f'--socket={u}/mysql/run/mysql.sock','--single-transaction','--no-tablespaces','--set-gtid-purged=OFF','--triggers',db],stdout=out,check=True)
 dump=dest/(db+'.sql.partial')
 assert b'Dump completed' in dump.read_bytes()[-300:]
 dump.rename(dest/(db+'.sql'));shutil.copytree(f/'storage',dest/'storage')
 if (f/'app/server/storage').is_dir():shutil.copytree(f/'app/server/storage',dest/'server-storage')
 (dest/'revision').write_bytes(sp.check_output(['git','rev-parse','HEAD'],cwd=f/'app'))
 print(dest)
if __name__=='__main__':
 os.umask(0o077);{'start':start,'stop':stop,'status':status,'backup':backup}[sys.argv[1]]()
