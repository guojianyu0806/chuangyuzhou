"""Activate a previously uploaded release; keep a rollback record and old files."""
# Competition copy: fail before reading arguments, archives, paths or credentials.
raise SystemExit('COMPETITION_DEPLOYMENT_DISABLED: historical production deployment is disabled in this competition copy.')

import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tarfile

archive = Path(sys.argv[1]).resolve()
release_id = sys.argv[2]
if not release_id.replace('-', '').isalnum() or len(release_id) > 64:
    raise SystemExit('Invalid release id')
target = Path('/opt/shiguang/releases') / release_id
if target.exists():
    raise SystemExit('Release already exists; refusing to overwrite it')
with tarfile.open(archive, 'r:gz') as tar:
    for item in tar.getmembers():
        parts = Path(item.name).parts
        if not parts or parts[0] not in ('frontend', 'backend', 'deployment') or '..' in parts or item.name.startswith('/') or item.issym() or item.islnk() or not (item.isfile() or item.isdir()):
            raise SystemExit('Unsafe release member')
    target.mkdir(mode=0o755)
    tar.extractall(target, filter='data')
for root, dirs, files in os.walk(target):
    os.chmod(root, 0o755)
    for name in files:
        os.chmod(Path(root) / name, 0o644)
current = Path('/opt/shiguang/current')
old = str(current.resolve()) if current.is_symlink() else None
if current.exists() and not current.is_symlink():
    raise SystemExit('Current is not a symlink; refusing to replace')
new = Path('/opt/shiguang/current-next')
if new.exists() or new.is_symlink():
    raise SystemExit('An unfinished activation exists; inspect it first')
new.symlink_to(target, target_is_directory=True)
new.replace(current)
record = target / 'deployment-activation.json'
record.write_text(json.dumps({'release':release_id,'previous':old,'current':str(target)},indent=2))
shutil.copy2(target / 'deployment/shiguang.service', '/etc/systemd/system/shiguang.service')
env = Path('/etc/shiguang/workbench.env')
if not env.exists():
    env.write_text('\n'.join([
        'HOST=127.0.0.1', 'PORT=4180', 'DATA_DIR=/var/lib/shiguang',
        'FRONTEND_DIR=/opt/shiguang/current/frontend',
        'PUBLIC_ORIGIN=https://example.invalid', 'SECURE_COOKIE=true',
        'SETUP_TOKEN_FILE=/var/lib/shiguang/setup-token',
        'SHIGUANG_HERMES_DIR=/home/ubuntu/.hermes/hermes-agent',
        'SHIGUANG_HERMES_PYTHON=/home/ubuntu/.hermes/hermes-agent/venv/bin/python',
        'SHIGUANG_EXTRACT_PYTHON=/opt/shiguang/extract-venv/bin/python', '',
    ]))
    env.chmod(0o600)
subprocess.run(['systemctl','daemon-reload'],check=True)
print(json.dumps({'release':str(target),'previous':old,'ready':True}))
