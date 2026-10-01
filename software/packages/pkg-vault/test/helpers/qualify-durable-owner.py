#!/usr/bin/env python3
# Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
"""Opt-in real private SQL protocol qualification, not functional deployment."""
import argparse, hashlib, json, os, pathlib, secrets, shutil, signal, subprocess, tempfile, time


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--execute-disposable-engine-qa',action='store_true',required=True)
    for name in ['tools-root','node','dependency-package','evidence-root']:
        parser.add_argument('--'+name,type=pathlib.Path,required=True)
    args=parser.parse_args()
    if os.geteuid()==0: raise RuntimeError('unprivileged_disposable_engine_required')
    tools=args.tools_root.resolve(strict=True)
    package=pathlib.Path(__file__).resolve().parents[2]
    args.evidence_root.mkdir(parents=True,exist_ok=True,mode=0o700)
    work=pathlib.Path(tempfile.mkdtemp(prefix='vault-owner-qa-',dir=args.evidence_root)); work.chmod(0o700)
    sockets=pathlib.Path(tempfile.mkdtemp(prefix='vault-owner-socket-')); sockets.chmod(0o700)
    processes=[]
    receipt={'passed':False,'network':'unix_socket_only','syntheticKeyAndDataOnly':True,
             'functionalPodmanQualified':False,'sourceFiles':{},'phases':[],'uid':os.geteuid()}
    for path in [package/'index.js',package/'durable-owner.js',package/'durable-owner.sql',pathlib.Path(__file__),pathlib.Path(__file__).with_name('durable-engine.mjs')]:
        receipt['sourceFiles'][str(path.relative_to(package))]=hashlib.sha256(path.read_bytes()).hexdigest()
    def run(argv,**kwargs):
        return subprocess.run([str(x) for x in argv],check=True,timeout=90,**kwargs)
    def sql(sock,content):
        return run([tools/'usr/bin/mariadb','--no-defaults','--protocol=socket',f'--socket={sock}','-uroot'],input=content.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    def stop(process):
        if process.poll() is None:
            process.send_signal(signal.SIGTERM);process.wait(timeout=30)
    def start(name,initialize=True):
        data=work/name;data.mkdir(mode=0o700,exist_ok=True)
        if initialize:
            with (work/f'{name}-install.log').open('wb') as log:
                run([tools/'usr/bin/mariadb-install-db','--no-defaults',f'--basedir={tools}/usr',f'--datadir={data}','--auth-root-authentication-method=normal','--skip-test-db'],stdout=log,stderr=subprocess.STDOUT)
        sock=sockets/f'{name}.sock';log=(work/f'{name}-server.log').open('ab')
        argv=[tools/'usr/sbin/mariadbd','--no-defaults',f'--basedir={tools}/usr',f'--datadir={data}',f'--socket={sock}',f'--pid-file={work}/{name}.pid','--skip-networking','--innodb-flush-log-at-trx-commit=1','--innodb-buffer-pool-size=64M','--max-connections=8',f'--log-error={work}/{name}-error.log']
        process=subprocess.Popen([str(x) for x in argv],stdout=log,stderr=subprocess.STDOUT);processes.append((process,log))
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            if process.poll() is not None: raise RuntimeError('owned_engine_start_failed')
            ping=subprocess.run([str(tools/'usr/bin/mariadb-admin'),'--no-defaults',f'--socket={sock}','-uroot','ping'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=2)
            if ping.returncode==0:return process,sock
            time.sleep(.1)
        raise RuntimeError('owned_engine_start_timeout')
    password=secrets.token_hex(24)
    def setup(sock,schema=True):
        statements='CREATE DATABASE IF NOT EXISTS qa_vault;'
        if schema: statements+='USE qa_vault;'+(package/'durable-owner.sql').read_text()
        statements+=f"CREATE USER 'qa_vault'@'localhost' IDENTIFIED BY '{password}';"
        statements+="GRANT SELECT,INSERT ON qa_vault.vault_owner_epochs TO 'qa_vault'@'localhost';"
        statements+="GRANT SELECT,INSERT,UPDATE(receipt_json) ON qa_vault.vault_owner_operations TO 'qa_vault'@'localhost';"
        statements+="GRANT SELECT,INSERT,UPDATE(revision,tombstoned,encrypted_payload,payload_digest) ON qa_vault.vault_owner_resources TO 'qa_vault'@'localhost';"
        sql(sock,statements)
    def phase(sock,name):
        config=work/f'{name}-client.json';config.write_text(json.dumps({'socketPath':str(sock),'user':'qa_vault','password':password,'database':'qa_vault','phase':name,'stateFile':str(work/'state.json'),'dependencyPackage':str(args.dependency_package.resolve(strict=True))}));config.chmod(0o600)
        try:
            with (work/f'{name}-fixture.log').open('wb') as log:
                run([args.node,pathlib.Path(__file__).with_name('durable-engine.mjs'),config],stdout=log,stderr=subprocess.STDOUT)
            receipt['phases'].append(json.loads((work/f'{name}-fixture.log').read_text()))
        finally: config.unlink(missing_ok=True)
    try:
        receipt['serverVersion']=run([tools/'usr/sbin/mariadbd','--version'],stdout=subprocess.PIPE).stdout.decode().strip()
        receipt['nodeVersion']=run([args.node,'--version'],stdout=subprocess.PIPE).stdout.decode().strip()
        process,sock=start('original');setup(sock)
        sql(sock,'SET GLOBAL innodb_flush_log_at_trx_commit=0;');phase(sock,'weak-durability')
        sql(sock,'SET GLOBAL innodb_flush_log_at_trx_commit=1;');phase(sock,'seed')
        crash_config=work/'crash-client.json'
        crash_config.write_text(json.dumps({'socketPath':str(sock),'user':'qa_vault','password':password,'database':'qa_vault','phase':'crash-before-commit','stateFile':str(work/'state.json'),'dependencyPackage':str(args.dependency_package.resolve(strict=True))}));crash_config.chmod(0o600)
        crash_log=(work/'crash-fixture.log').open('wb')
        crash=subprocess.Popen([str(args.node),str(pathlib.Path(__file__).with_name('durable-engine.mjs')),str(crash_config)],stdout=crash_log,stderr=subprocess.STDOUT);processes.append((crash,crash_log))
        try:
            deadline=time.monotonic()+10
            while not (work/'state.json.crash').exists():
                if crash.poll() is not None or time.monotonic()>deadline:raise RuntimeError('owned_crash_fixture_unready')
                time.sleep(.02)
            crash.kill();crash.wait(timeout=10)
            if crash.returncode!=-signal.SIGKILL:raise RuntimeError('owned_crash_fixture_not_killed')
            receipt['phases'].append({'phase':'crash-before-commit','passed':True,'processExit':crash.returncode,'uncommittedResourceWitness':True})
        finally:crash_config.unlink(missing_ok=True)
        stop(process)
        process,sock=start('original',False);phase(sock,'restart')
        dump=work/'dump.sql'
        with dump.open('wb') as output:
            run([tools/'usr/bin/mariadb-dump','--no-defaults',f'--socket={sock}','-uroot','--single-transaction','qa_vault'],stdout=output,stderr=subprocess.PIPE)
        dump.chmod(0o600)
        if not dump.stat().st_size:raise RuntimeError('nonempty_dump_required')
        receipt['dumpSha256']=hashlib.sha256(dump.read_bytes()).hexdigest();stop(process)
        restored,restore_sock=start('restored');sql(restore_sock,'CREATE DATABASE qa_vault;USE qa_vault;'+dump.read_text());setup(restore_sock,False)
        phase(restore_sock,'restore');stop(restored);receipt['passed']=True
    finally:
        cleanup=True
        for process,log in processes:
            try:stop(process)
            except Exception:cleanup=False
            log.close()
        receipt['ownedProcessesReaped']=cleanup and all(p.poll() is not None for p,_ in processes)
        if receipt['ownedProcessesReaped']:shutil.rmtree(sockets)
        receipt['socketDirectoryRemoved']=not sockets.exists();receipt['ownedPids']=[p.pid for p,_ in processes]
        receipt['passed']=receipt['passed'] and receipt['ownedProcessesReaped'] and receipt['socketDirectoryRemoved']
        (work/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(work/'receipt.json')
    if not receipt['passed']:raise RuntimeError('disposable_engine_qualification_failed')

if __name__=='__main__':main()
