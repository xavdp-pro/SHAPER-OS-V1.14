#!/usr/bin/env python3
# Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
"""Opt-in real private SQL protocol qualification, not functional deployment."""
import ast, argparse, hashlib, json, os, pathlib, secrets, shutil, signal, subprocess, tempfile, time


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
    work=pathlib.Path(tempfile.mkdtemp(prefix='vault-disclosure-qa-',dir=args.evidence_root)); work.chmod(0o700)
    sockets=pathlib.Path(tempfile.mkdtemp(prefix='vault-disclosure-socket-')); sockets.chmod(0o700)
    processes=[]
    receipt={'passed':False,'network':'unix_socket_only','syntheticKeyAndDataOnly':True,
             'functionalPodmanQualified':False,'sourceFiles':{},'phases':[],'uid':os.geteuid()}
    for path in [package/'index.js',package/'durable-owner.js',package/'durable-owner.sql',package/'durable-guard-owner.js',package/'durable-disclosure-owner.js',package/'durable-runtime.mjs',pathlib.Path(__file__),package.parents[1]/'bricks/brick-vault/start-durable-vault.py',pathlib.Path(__file__).with_name('disclosure-engine.mjs'),pathlib.Path(__file__).with_name('durable-engine.mjs')]:
        receipt['sourceFiles'][os.path.relpath(path,package)]=hashlib.sha256(path.read_bytes()).hexdigest()
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
    def setup(sock,schema=True,stage=6):
        statements='CREATE DATABASE IF NOT EXISTS vault;'
        if schema:
            text=(package/'durable-owner.sql').read_text()
            if stage==3:text=text.split('-- Additive guard upgrade:')[0]
            if stage==5:text=text.split('-- Current disclosure is additive')[0]
            statements+='USE vault;'+text
        statements+=f"CREATE USER IF NOT EXISTS 'vault'@'localhost' IDENTIFIED BY '{password}';"
        statements+="GRANT SELECT,INSERT ON vault.vault_owner_epochs TO 'vault'@'localhost';"
        statements+="GRANT SELECT,INSERT,UPDATE(receipt_json) ON vault.vault_owner_operations TO 'vault'@'localhost';"
        statements+="GRANT SELECT,INSERT,UPDATE(revision,tombstoned,encrypted_payload,payload_digest) ON vault.vault_owner_resources TO 'vault'@'localhost';"
        if stage>=5: statements+="GRANT SELECT,INSERT,UPDATE(managed,held_guard_id,deny_new,deny_operation_id,deny_revision,deny_request_digest) ON vault.vault_owner_resource_fences TO 'vault'@'localhost';"
        if stage>=5: statements+="GRANT SELECT,INSERT,UPDATE(state,terminal_ack_json,terminal_ack_digest) ON vault.vault_owner_guards TO 'vault'@'localhost';"
        if stage>=6: statements+="GRANT SELECT,INSERT,UPDATE(state,closure_json,closure_digest) ON vault.vault_owner_disclosures TO 'vault'@'localhost';"
        sql(sock,statements)
    def phase(sock,name):
        config=work/f'{name}-client.json';config.write_text(json.dumps({'socketPath':str(sock),'user':'vault','password':password,'database':'vault','phase':name,'stateFile':str(work/'state.json'),'dependencyPackage':str(args.dependency_package.resolve(strict=True))}));config.chmod(0o600)
        try:
            with (work/f'{name}-fixture.log').open('wb') as log:
                run([args.node,pathlib.Path(__file__).with_name('disclosure-engine.mjs'),config],stdout=log,stderr=subprocess.STDOUT)
            receipt['phases'].append(json.loads((work/f'{name}-fixture.log').read_text()))
        finally: config.unlink(missing_ok=True)
    try:
        receipt['serverVersion']=run([tools/'usr/sbin/mariadbd','--version'],stdout=subprocess.PIPE).stdout.decode().strip()
        receipt['nodeVersion']=run([args.node,'--version'],stdout=subprocess.PIPE).stdout.decode().strip()
        process,sock=start('original');setup(sock,stage=3);phase(sock,'legacy-three')
        setup(sock,stage=5);phase(sock,'legacy-five')
        setup(sock,stage=6);phase(sock,'seed')
        setup(sock,stage=6);phase(sock,'idempotent-upgrade')
        sql(sock,"GRANT UPDATE(binding_json) ON vault.vault_owner_disclosures TO 'vault'@'localhost';");phase(sock,'excess-grant')
        sql(sock,"REVOKE UPDATE(binding_json) ON vault.vault_owner_disclosures FROM 'vault'@'localhost';")
        sql(sock,'CREATE TABLE vault.foreign_fixture (id INT);')
        # The confined account cannot see an ungranted foreign table. Owning
        # startup's administrative preflight must refuse it before migration.
        bootstrap=package.parents[1]/'bricks/brick-vault/start-durable-vault.py'
        function=next(node for node in ast.parse(bootstrap.read_text()).body if isinstance(node,ast.FunctionDef) and node.name=='validate_schema_rows')
        namespace={};exec(compile(ast.Module(body=[function],type_ignores=[]),str(bootstrap),'exec'),namespace)
        rows=sql(sock,"SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='vault' ORDER BY TABLE_NAME,ORDINAL_POSITION;").stdout.decode().splitlines()[1:]
        try:namespace['validate_schema_rows'](rows)
        except RuntimeError as error:
            if str(error)!='vault_owner_database_schema_invalid':raise
        else:raise RuntimeError('foreign_schema_not_refused')
        receipt['phases'].append({'phase':'unknown-schema-preflight','passed':True,'actualAdminMetadata':True,'actualOwningValidator':True})
        phase(sock,'unknown-preserved')
        sql(sock,'DROP TABLE vault.foreign_fixture;')
        stop(process)
        process,sock=start('original',False);phase(sock,'restart')
        dump=work/'dump.sql'
        with dump.open('wb') as output:
            run([tools/'usr/bin/mariadb-dump','--no-defaults',f'--socket={sock}','-uroot','--single-transaction','vault'],stdout=output,stderr=subprocess.PIPE)
        dump.chmod(0o600)
        if not dump.stat().st_size:raise RuntimeError('nonempty_dump_required')
        receipt['dumpSha256']=hashlib.sha256(dump.read_bytes()).hexdigest();stop(process)
        restored,restore_sock=start('restored');sql(restore_sock,'CREATE DATABASE vault;USE vault;'+dump.read_text());setup(restore_sock,False)
        phase(restore_sock,'restore');stop(restored)
        for f,h in receipt['sourceFiles'].items():
            if hashlib.sha256((package/f).read_bytes()).hexdigest()!=h:raise RuntimeError('source_changed_during_qualification')
        receipt['sourceUnchangedDuringQualification']=True
        receipt['passed']=True
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
        if receipt['passed']:
            (work/'state.json').unlink(missing_ok=True);(work/'dump.sql').unlink(missing_ok=True)
            for name in ['original','restored']:shutil.rmtree(work/name)
            receipt['ownedSyntheticStateRemoved']=True
        (work/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(work/'receipt.json')
    if not receipt['passed']:raise RuntimeError('disposable_engine_qualification_failed')

if __name__=='__main__':main()
