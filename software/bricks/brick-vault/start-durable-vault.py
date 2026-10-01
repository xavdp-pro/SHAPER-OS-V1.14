#!/usr/bin/env python3
# Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
"""Owning Vault's opt-in private SQL lifecycle; no legacy file migration."""
import os, pathlib, pwd, re, secrets, signal, stat, subprocess, sys, time

ROOT=pathlib.Path('/apps/vault')
IDENTITY=pwd.getpwnam('vault')
CHILDREN=[]
STOP=False


def open_beneath(path,flags=os.O_RDONLY):
    parts=pathlib.Path(path).parts
    if not parts or parts[0]!='/':raise RuntimeError('vault_owner_path_invalid')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for index,part in enumerate(parts[1:]):
            child=os.open(part,(flags if index==len(parts)-2 else os.O_RDONLY|os.O_DIRECTORY)|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
        return fd
    except Exception:os.close(fd);raise


def private_file(path):
    fd=open_beneath(path)
    try:
        metadata=os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid!=IDENTITY.pw_uid or stat.S_IMODE(metadata.st_mode)!=0o600 or metadata.st_nlink!=1:
            raise RuntimeError('vault_owner_private_file_invalid')
        value=os.read(fd,4097).decode().strip()
        if len(value)!=64 or any(c not in '0123456789abcdef' for c in value):raise RuntimeError('vault_owner_private_file_invalid')
        return value
    finally:os.close(fd)


def validate_directory(path,uid,mode,optional=False):
    try:fd=open_beneath(path,os.O_RDONLY|os.O_DIRECTORY)
    except FileNotFoundError:
        if optional:return False
        raise RuntimeError('vault_owner_directory_missing')
    except OSError:raise RuntimeError('vault_owner_directory_invalid')
    try:
        metadata=os.fstat(fd)
        if metadata.st_uid!=uid or stat.S_IMODE(metadata.st_mode)!=mode:raise RuntimeError('vault_owner_directory_invalid')
        return True
    finally:os.close(fd)


def directory(path):
    # All existing ancestors and this leaf were checked before any mutation.
    if validate_directory(path,IDENTITY.pw_uid,0o700,optional=True):return
    parent=open_beneath(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:
        os.mkdir(path.name,mode=0o700,dir_fd=parent)
        fd=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
        try:os.fchown(fd,IDENTITY.pw_uid,IDENTITY.pw_gid);os.fsync(fd)
        finally:os.close(fd)
        os.fsync(parent)
    finally:os.close(parent)


def preflight():
    # Podman read-only roots are mounted 0555; image-owned writable roots are 0755.
    root_fd=open_beneath('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        root_stat=os.fstat(root_fd)
        if root_stat.st_uid!=0 or stat.S_IMODE(root_stat.st_mode) not in (0o555,0o755):raise RuntimeError('vault_owner_directory_invalid')
    finally:os.close(root_fd)
    for path in ['/apps','/apps/vault','/apps/vault/app']:
        validate_directory(path,0,0o755)
    validate_directory(ROOT/'nosav',IDENTITY.pw_uid,0o755)
    for path in ['etc','etc/owner','sav','log','nosav/mysql']:
        validate_directory(ROOT/path,IDENTITY.pw_uid,0o700)
    for path in ['etc/mysql','etc/mysql/localhost','sav/mariadb']:
        validate_directory(ROOT/path,IDENTITY.pw_uid,0o700,optional=True)
    private_file(ROOT/'etc/owner/master-key');private_file(ROOT/'etc/owner/token')
    try:private_file(ROOT/'etc/mysql/localhost/passwd')
    except FileNotFoundError:pass
    marker=ROOT/'sav/runtime-source'
    expected='shaper.vault-private-owner.v1\nvault\n'+os.environ['VAULT_UNIVERSE_ID']+'\n'
    try:
        fd=open_beneath(marker)
        try:
            metadata=os.fstat(fd)
            if metadata.st_uid!=IDENTITY.pw_uid or stat.S_IMODE(metadata.st_mode)!=0o600 or metadata.st_nlink!=1 or not stat.S_ISREG(metadata.st_mode) or os.read(fd,4097).decode()!=expected:
                raise RuntimeError('vault_owner_source_mismatch')
        finally:os.close(fd)
    except FileNotFoundError:
        try:fd=open_beneath(ROOT/'sav/mariadb',os.O_RDONLY|os.O_DIRECTORY)
        except FileNotFoundError:return
        try:
            if os.listdir(fd):raise RuntimeError('vault_owner_unknown_existing_database')
        finally:os.close(fd)


def sql(content):
    result=subprocess.run(['/usr/bin/mariadb','--no-defaults','--protocol=socket',f'--socket={ROOT}/nosav/mysql/vault.sock','-uroot'],input=content.encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=8)
    if result.returncode:raise RuntimeError('vault_owner_administration_failed')


def stop(signum,frame):
    global STOP
    STOP=True


def main():
    if os.geteuid()!=0 or IDENTITY.pw_name!='vault':raise RuntimeError('vault_owner_bootstrap_identity_invalid')
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_-]{0,63}',os.environ.get('VAULT_UNIVERSE_ID','')):raise RuntimeError('vault_owner_scope_required')
    preflight()
    directory(ROOT/'etc/mysql');directory(ROOT/'etc/mysql/localhost')
    password_path=ROOT/'etc/mysql/localhost/passwd'
    if not password_path.exists():
        parent=open_beneath(password_path.parent,os.O_RDONLY|os.O_DIRECTORY)
        fd=os.open(password_path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        os.close(parent)
        try:
            os.fchown(fd,IDENTITY.pw_uid,IDENTITY.pw_gid);os.write(fd,secrets.token_hex(32).encode());os.fsync(fd)
        finally:os.close(fd)
        fd=os.open(password_path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    password=private_file(password_path)
    for path in [ROOT/'sav/mariadb',ROOT/'log',ROOT/'nosav/mysql']:directory(path)
    if not (ROOT/'sav/mariadb/mysql').exists():
        result=subprocess.run(['/usr/bin/mariadb-install-db','--no-defaults',f'--datadir={ROOT}/sav/mariadb','--user=vault','--auth-root-authentication-method=socket','--auth-root-socket-user=root','--skip-test-db'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45)
        if result.returncode:raise RuntimeError('vault_owner_database_initialization_failed')
    database=subprocess.Popen(['/usr/sbin/mariadbd','--no-defaults','--user=vault',f'--datadir={ROOT}/sav/mariadb',f'--socket={ROOT}/nosav/mysql/vault.sock',f'--pid-file={ROOT}/nosav/mysql/server.pid','--skip-networking','--innodb-flush-log-at-trx-commit=1','--innodb-buffer-pool-size=64M','--max-connections=8',f'--log-error={ROOT}/log/mariadb-error.log'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    CHILDREN.append(database)
    deadline=time.monotonic()+30
    while True:
        if database.poll() is not None or STOP:raise RuntimeError('vault_owner_database_start_failed')
        result=subprocess.run(['/usr/bin/mariadb-admin','--no-defaults',f'--socket={ROOT}/nosav/mysql/vault.sock','-uroot','ping'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=2)
        if result.returncode==0:break
        if time.monotonic()>deadline:raise RuntimeError('vault_owner_database_start_timeout')
        time.sleep(.1)
    marker=ROOT/'sav/runtime-source'
    if not marker.exists():
        parent=open_beneath(marker.parent,os.O_RDONLY|os.O_DIRECTORY)
        fd=os.open(marker.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        try:
            os.fchown(fd,IDENTITY.pw_uid,IDENTITY.pw_gid);os.write(fd,('shaper.vault-private-owner.v1\nvault\n'+os.environ['VAULT_UNIVERSE_ID']+'\n').encode());os.fsync(fd);os.fsync(parent)
        finally:os.close(fd);os.close(parent)
    sql('CREATE DATABASE IF NOT EXISTS vault;USE vault;'+(ROOT/'app/pkg-vault/durable-owner.sql').read_text())
    # No REVOKE/reset: an inherited broad grant must cause application startup
    # refusal rather than being silently repaired or accepted.
    sql(f"CREATE USER IF NOT EXISTS 'vault'@'localhost' IDENTIFIED BY '{password}';ALTER USER 'vault'@'localhost' IDENTIFIED BY '{password}';"
        "GRANT SELECT,INSERT ON vault.vault_owner_epochs TO 'vault'@'localhost';"
        "GRANT SELECT,INSERT,UPDATE(receipt_json) ON vault.vault_owner_operations TO 'vault'@'localhost';"
        "GRANT SELECT,INSERT,UPDATE(revision,tombstoned,encrypted_payload,payload_digest) ON vault.vault_owner_resources TO 'vault'@'localhost';"
        "GRANT SELECT,INSERT,UPDATE(managed,held_guard_id,deny_new,deny_operation_id,deny_revision,deny_request_digest) ON vault.vault_owner_resource_fences TO 'vault'@'localhost';"
        "GRANT SELECT,INSERT,UPDATE(state,terminal_ack_json,terminal_ack_digest) ON vault.vault_owner_guards TO 'vault'@'localhost';")
    application=subprocess.Popen(['/usr/bin/setpriv','--reuid=vault','--regid=vault','--init-groups','node',str(ROOT/'app/pkg-vault/durable-runtime.mjs')],stdin=subprocess.DEVNULL)
    CHILDREN.append(application)
    while not STOP:
        if application.poll() is not None or database.poll() is not None:raise RuntimeError('vault_owner_function_process_failed')
        time.sleep(.1)


if __name__=='__main__':
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    status=0
    try:main()
    except Exception as error:
        message=str(error);print(message if message.startswith('vault_owner_') and message.replace('_','').isalnum() else 'vault_owner_bootstrap_failed',file=sys.stderr);status=1
    finally:
        for process in reversed(CHILDREN):
            if process.poll() is None:process.terminate()
            try:process.wait(timeout=12)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3);status=1
    sys.exit(status)
