"""Operate the dedicated local rehearsal services. Run with start, stop or backup."""
import datetime
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
mysql = Path('/usr/local/mysql/bin')
run = root/'run'
control = [str(mysql/'mysqladmin'), f'--defaults-file={root}/private/mysql-root.cnf', '--host=localhost', '--protocol=SOCKET', f'--socket={root}/mysql/run/mysql.sock']
services = {
    'api': ([shutil.which('node'), 'src/index.js'], root/'app/server'),
    'client': ([shutil.which('node'), str(root/'app/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '5273', '--strictPort'], root/'app/client')
}
def running(name):
    pidfile = run/f'{name}.pid'
    if not pidfile.exists():
        return None
    pid = int(pidfile.read_text())
    cmd = subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
    if cmd.returncode:
        return None
    cwd_result = subprocess.run(['lsof','-a','-p',str(pid),'-d','cwd','-Fn'],text=True,capture_output=True)
    if cwd_result.returncode:
        state = subprocess.run(['ps','-p',str(pid),'-o','stat='],text=True,capture_output=True)
        if state.returncode or state.stdout.strip().startswith('Z'):
            return None
        raise SystemExit('Cannot verify UAT process directory: '+name)
    cwd = cwd_result.stdout
    if 'n'+str(services[name][1]) not in cwd.splitlines() or ' '.join(services[name][0][1:]) not in cmd.stdout:
        raise SystemExit('PID owner differs from UAT process: '+name)
    return pid
def start():
    if subprocess.run(control+['ping'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        subprocess.run([str(mysql/'mysqld'),'--no-defaults','--daemonize','--basedir=/usr/local/mysql',f'--datadir={root}/mysql/data',f'--socket={root}/mysql/run/mysql.sock','--bind-address=127.0.0.1','--port=3406','--mysqlx=0','--skip-log-bin',f'--pid-file={root}/mysql/run/mysqld.pid',f'--log-error={root}/mysql/run/mysqld.log'],check=True)
    for name,(cmd,cwd) in services.items():
        if running(name):
            continue
        with (run/f'{name}.log').open('ab') as log:
            proc=subprocess.Popen(cmd,cwd=cwd,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        (run/f'{name}.pid').write_text(str(proc.pid)+'\n')
def stop():
    for name in ['client','api']:
        pid=running(name)
        if pid:
            os.kill(pid,signal.SIGTERM)
            for _ in range(320):
                if not running(name):
                    break
                time.sleep(0.1)
            else:
                raise SystemExit(name+' is still running')
    subprocess.run(control+['shutdown'],check=True)
def backup():
    stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    dest=root/'backup'/stamp
    dest.mkdir(mode=0o700)
    dump=dest/'erp_uat.sql.partial'
    with dump.open('xb') as f:
        subprocess.run([str(mysql/'mysqldump'),f'--defaults-file={root}/private/mysql-root.cnf','--host=localhost','--protocol=SOCKET',f'--socket={root}/mysql/run/mysql.sock','--single-transaction','--no-tablespaces','--set-gtid-purged=OFF','--triggers','erp_uat'],stdout=f,check=True)
    dump.rename(dest/'erp_uat.sql')
    shutil.copytree(root/'storage',dest/'storage')
    (dest/'revision').write_bytes(subprocess.check_output(['git','rev-parse','HEAD'],cwd=root/'app'))
    print(dest)
if __name__=='__main__':
    os.umask(0o077)
    {'start':start,'stop':stop,'backup':backup}[sys.argv[1]]()
