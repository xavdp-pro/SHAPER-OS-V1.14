#!/usr/bin/env python3
# Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
"""Explicit, owned synthetic functional Vault qualification on a Podman host."""
import argparse, hashlib, json, os, pathlib, re, secrets, shutil, subprocess, tempfile, time


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--execute-disposable-function-qa',action='store_true',required=True)
    parser.add_argument('--legacy-image');parser.add_argument('--image',required=True);parser.add_argument('--prefix',required=True)
    parser.add_argument('--evidence-root',type=pathlib.Path,required=True)
    args=parser.parse_args()
    if os.geteuid()!=0 or not re.fullmatch('[a-z0-9][a-z0-9-]{1,48}',args.prefix) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9:/.@_-]+',args.image):
        raise RuntimeError('owned_function_qa_admission_invalid')
    args.evidence_root.mkdir(parents=True,exist_ok=True,mode=0o700)
    root=pathlib.Path(tempfile.mkdtemp(prefix=args.prefix+'-',dir=args.evidence_root));root.chmod(0o700)
    state=root/'state';state.mkdir(mode=0o700)
    owner=secrets.token_hex(16);owned=[];cases={}
    receipt={'passed':False,'productionDataTouched':False,'syntheticOnly':True,'phases':[],'startupNegatives':[],
             'network':'none','publishedPorts':False,'cpuLimit':1,'memoryLimitMiB':512,'readonlyRoot':True}
    def run(argv,**kwargs):return subprocess.run([str(x) for x in argv],check=True,timeout=90,**kwargs)
    def running():return sorted(run(['podman','ps','--format','{{.ID}}'],stdout=subprocess.PIPE).stdout.decode().split())
    baseline=running()
    def inspect(cid):return json.loads(run(['podman','inspect',cid],stdout=subprocess.PIPE).stdout)[0]
    def assert_owned(cid):
        if inspect(cid)['Config']['Labels'].get('org.shaper.qa-owner')!=owner:raise RuntimeError('owned_container_identity_changed')
    def prepare(name,restore=None):
        data=state/name;data.mkdir(mode=0o700)
        for suffix in ['etc','etc/owner','etc/mysql','etc/mysql/localhost','sav','log','mysql','temporary','qa-state']:
            path=data/suffix;path.mkdir(parents=True,exist_ok=True,mode=0o700);path.chmod(0o700);os.chown(path,10001,10001)
        if restore:
            shutil.copytree(restore/'etc',data/'etc',dirs_exist_ok=True)
            shutil.copytree(restore/'qa-state',data/'qa-state',dirs_exist_ok=True)
            for path in [data/'etc',*(data/'etc').rglob('*'),data/'qa-state',*(data/'qa-state').rglob('*')]:os.chown(path,10001,10001)
        else:
            for key_name in ['master-key','token']:
                path=data/'etc/owner'/key_name;path.write_text(secrets.token_hex(32));path.chmod(0o600);os.chown(path,10001,10001)
        cases[name]=data;return data
    def start(name,data,image=None):
        argv=['podman','run','-d','--name',args.prefix+'-'+name,'--label','org.shaper.qa-owner='+owner,'--network','none','--read-only','--cpus','1','--memory','512m','--pids-limit','96','--security-opt','no-new-privileges',
          '--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER','--cap-add','DAC_OVERRIDE','--cap-add','SETUID','--cap-add','SETGID','--cap-add','KILL','--env','VAULT_UNIVERSE_ID=synthetic']
        for host,target in [(data/'etc','/apps/vault/etc'),(data/'sav','/apps/vault/sav'),(data/'log','/apps/vault/log'),(data/'mysql','/apps/vault/nosav/mysql'),(data/'temporary','/tmp'),(data/'qa-state','/qa-state')]:argv+=['--volume',str(host)+':'+target+':rw']
        argv+=['--volume',str(pathlib.Path(__file__).resolve().parent)+':/qa:ro']
        if (data/'outside').exists():argv+=['--volume',str(data/'outside')+':/outside:rw']
        argv+=[image or args.image];cid=run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.decode().strip()
        if not re.fullmatch('[a-f0-9]{64}',cid):raise RuntimeError('owned_container_id_invalid')
        owned.append(cid);return cid
    def wait_ready(cid):
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            if not inspect(cid)['State']['Running']:raise RuntimeError('owned_function_start_failed')
            result=subprocess.run(['podman','exec',cid,'node','-e',"fetch('http://127.0.0.1:8610/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=4)
            if result.returncode==0:return
            time.sleep(.2)
        raise RuntimeError('owned_function_start_timeout')
    def phase(cid,name):
        assert_owned(cid)
        result=subprocess.run(['podman','exec','--user','vault',cid,'node','/qa/functional-http.mjs',name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=90)
        (root/(name+'-fixture.log')).write_bytes(result.stdout+result.stderr)
        result.check_returncode()
        receipt['phases'].append(json.loads(result.stdout))
    def sql(cid,content,stdout=subprocess.DEVNULL):
        assert_owned(cid)
        return run(['podman','exec','-i','--user','root',cid,'mariadb','--no-defaults','--protocol=socket','--socket=/apps/vault/nosav/mysql/vault.sock','-uroot'],input=content.encode(),stdout=stdout,stderr=subprocess.DEVNULL)
    def tree(path):
        result={}
        for item in [path,*sorted(path.rglob('*'))]:
            metadata=item.lstat();entry={'uid':metadata.st_uid,'gid':metadata.st_gid,'mode':metadata.st_mode,'inode':metadata.st_ino,'mtimeNs':metadata.st_mtime_ns}
            if item.is_file():entry['sha256']=hashlib.sha256(item.read_bytes()).hexdigest()
            result[str(item.relative_to(path))]=entry
        return result
    def stopped_refusal(cid,name):
        deadline=time.monotonic()+60
        while inspect(cid)['State']['Running'] and time.monotonic()<deadline:time.sleep(.1)
        info=inspect(cid)
        if info['State']['Running'] or info['State']['ExitCode']!=1:raise RuntimeError('startup_negative_not_refused')
        logs=run(['podman','logs',cid],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        text=logs.stdout+logs.stderr
        if not re.search(rb'vault_owner_[a-z_]+',text):raise RuntimeError('startup_negative_missing_safe_error')
        (root/(name+'-startup.log')).write_bytes(text)
        receipt['startupNegatives'].append({'case':name,'passed':True,'exitCode':info['State']['ExitCode']})
    try:
        image=json.loads(run(['podman','image','inspect',args.image],stdout=subprocess.PIPE).stdout)[0]
        receipt['imageId']=image['Id'];receipt['imageSourceRevision']=image['Config']['Labels'].get('org.opencontainers.image.revision')
        receipt['fixtureHashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [pathlib.Path(__file__),pathlib.Path(__file__).with_name('functional-http.mjs')]}
        if args.legacy_image:
            if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9:/.@_-]+',args.legacy_image):raise RuntimeError('legacy_image_admission_invalid')
            old=json.loads(run(['podman','image','inspect',args.legacy_image],stdout=subprocess.PIPE).stdout)[0]
            receipt['legacyImageId']=old['Id'];receipt['legacyImageSourceRevision']=old['Config']['Labels'].get('org.opencontainers.image.revision')
            if receipt['legacyImageSourceRevision']!='c67b0df':raise RuntimeError('legacy_source_identity_invalid')
            upgrade=prepare('upgrade');oldcid=start('upgrade-old',upgrade,args.legacy_image);wait_ready(oldcid);phase(oldcid,'upgrade-seed')
            protected=[upgrade/'etc/owner/master-key',upgrade/'etc/owner/token',upgrade/'etc/mysql/localhost/passwd',upgrade/'sav/runtime-source']
            baseline_private={str(p.relative_to(upgrade)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}
            assert_owned(oldcid);run(['podman','stop','--time','30',oldcid],stdout=subprocess.DEVNULL)
            newcid=start('upgrade-new',upgrade);wait_ready(newcid);phase(newcid,'upgrade')
            assert_owned(newcid);run(['podman','restart','--time','30',newcid],stdout=subprocess.DEVNULL);wait_ready(newcid);phase(newcid,'upgrade-restart');phase(newcid,'upgrade-write')
            if {str(p.relative_to(upgrade)):hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}!=baseline_private:raise RuntimeError('upgrade_private_custody_changed')
            receipt['legacyPrivateKeysPasswordAndSourceMarkerUnchanged']=True
            receipt['legacyThreeTableUpgradePreserved']=True
            assert_owned(newcid);run(['podman','stop','--time','30',newcid],stdout=subprocess.DEVNULL)
        original=prepare('original');cid=start('original',original);wait_ready(cid);
        run(['podman','exec','--user','vault',cid,'node','--input-type=module','-e',"await import('/apps/vault/app/pkg-vault/durable-guard-owner.js');await import('/apps/vault/app/pkg-vault/durable-runtime.mjs')"],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        receipt['coldGuardAndLegacyRuntimeImportPassed']=True;phase(cid,'seed')
        metadata_script="import json,pathlib; out=[]\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:\n  c=(p/'cmdline').read_bytes().split(b'\\0'); s=(p/'status').read_text(); u=[x for x in s.splitlines() if x.startswith('Uid:')][0].split()[1:]; n=c[0].decode().split('/')[-1];\n  if n in ['node','mariadbd']:out.append({'pid':int(p.name),'name':n,'uids':u})\n except (FileNotFoundError,PermissionError,IndexError):pass\nprint(json.dumps(out))"
        identities=json.loads(run(['podman','exec',cid,'python3','-c',metadata_script],stdout=subprocess.PIPE).stdout)
        if not any(p['name']=='mariadbd' and p['uids']==['10001']*4 for p in identities) or not any(p['name']=='node' and p['uids']==['10001']*4 for p in identities):raise RuntimeError('actual_function_identities_invalid')
        receipt['applicationAndDatabaseLinuxIdentity']=identities
        assert_owned(cid);run(['podman','restart','--time','30',cid],stdout=subprocess.DEVNULL);wait_ready(cid);phase(cid,'restart')
        dump=root/'vault-dump.sql'
        with dump.open('wb') as output:
            run(['podman','exec','--user','root',cid,'mariadb-dump','--no-defaults','--socket=/apps/vault/nosav/mysql/vault.sock','-uroot','--single-transaction','vault'],stdout=output,stderr=subprocess.DEVNULL)
        dump.chmod(0o600);receipt['dumpSha256']=hashlib.sha256(dump.read_bytes()).hexdigest()
        if not dump.stat().st_size:raise RuntimeError('nonempty_dump_required')
        assert_owned(cid);run(['podman','stop','--time','30',cid],stdout=subprocess.DEVNULL)
        restored=prepare('restored',original);rid=start('restored',restored);wait_ready(rid)
        sql(rid,'USE vault;'+dump.read_text());phase(rid,'restore')
        # Additive startup must reject extra privileges, not remove them.
        sql(rid,"GRANT UPDATE ON vault.vault_owner_operations TO 'vault'@'localhost';")
        assert_owned(rid);run(['podman','restart','--time','30',rid],stdout=subprocess.DEVNULL);stopped_refusal(rid,'excess-table-grant')
        sql_cases={
          'excess-binding-update':"GRANT UPDATE(binding_json) ON vault.vault_owner_guards TO 'vault'@'localhost';",
          'foreign-schema-grant':"CREATE DATABASE foreign_function;GRANT SELECT ON foreign_function.* TO 'vault'@'localhost';",
          'excess-grant-option':"GRANT SELECT ON vault.vault_owner_guards TO 'vault'@'localhost' WITH GRANT OPTION;",
          'altered-owned-schema':"ALTER TABLE vault.vault_owner_guards ADD unexpected INT;"
        }
        for name,statement in sql_cases.items():
            data=prepare(name);bad=start(name,data);wait_ready(bad);sql(bad,statement)
            private_before={str(p.relative_to(data)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [data/'etc/owner/master-key',data/'etc/owner/token',data/'etc/mysql/localhost/passwd',data/'sav/runtime-source']}
            assert_owned(bad);run(['podman','restart','--time','30',bad],stdout=subprocess.DEVNULL);stopped_refusal(bad,name)
            if {p:hashlib.sha256((data/p).read_bytes()).hexdigest() for p in private_before}!=private_before:raise RuntimeError('refusal_private_custody_changed')
            receipt['startupNegatives'][-1]['privateCustodyUnchanged']=True
        for name in ['missing-key','key-mode','ancestor-symlink','foreign-directory','unknown-database']:
            data=prepare(name);protected=None;before=None
            if name=='missing-key':(data/'etc/owner/master-key').unlink()
            elif name=='key-mode':(data/'etc/owner/master-key').chmod(0o644)
            elif name=='ancestor-symlink':
                protected=data/'outside';protected.mkdir(mode=0o710);os.chown(protected,20002,20002);(protected/'sentinel').write_text('synthetic_outside_content');os.chown(protected/'sentinel',20002,20002)
                shutil.rmtree(data/'etc/mysql');(data/'etc/mysql').symlink_to('/outside');before=tree(protected)
            elif name=='foreign-directory':
                protected=data/'sav/mariadb';protected.mkdir(mode=0o750);os.chown(protected,20002,20002);(protected/'sentinel').write_text('synthetic_foreign_content');os.chown(protected/'sentinel',20002,20002);before=tree(protected)
            else:
                protected=data/'sav/mariadb';protected.mkdir(mode=0o700);os.chown(protected,10001,10001);(protected/'sentinel').write_text('synthetic_unknown_database');before=tree(protected)
            bad=start(name,data);stopped_refusal(bad,name)
            if protected:
                if tree(protected)!=before:raise RuntimeError('negative_outside_state_mutated')
                receipt['startupNegatives'][-1]['outsideMetadataAndContentUnchanged']=True
            if (data/'etc/mysql/localhost/passwd').exists():raise RuntimeError('negative_mutated_password_state')
        receipt['passed']=True
    except Exception as error:
        receipt['failureClass']=type(error).__name__
        for number,cid in enumerate(owned):
            try:
                assert_owned(cid)
                logs=subprocess.run(['podman','logs',cid],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
                (root/('failure-container-'+str(number)+'.log')).write_bytes(logs.stdout+logs.stderr)
            except Exception:pass
        raise
    finally:
        cleanup=True
        for cid in reversed(owned):
            try:assert_owned(cid);run(['podman','rm','--force',cid],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            except Exception:cleanup=False
        receipt['ownedContainersRemoved']=cleanup
        receipt['unrelatedRunningIdsUnchanged']=running()==baseline
        if cleanup:shutil.rmtree(state)
        receipt['syntheticCredentialStateRemoved']=not state.exists()
        receipt['passed']=receipt['passed'] and cleanup and receipt['unrelatedRunningIdsUnchanged'] and receipt['syntheticCredentialStateRemoved']
        (root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(root/'receipt.json')
    if not receipt['passed']:raise RuntimeError('functional_podman_qualification_failed')

if __name__=='__main__':main()
